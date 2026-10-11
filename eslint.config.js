import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Границы слоёв — п. 14.2 ТЗ. Нарушение = ошибка линтера в CI (критерий приёмки 19).
const layerRules = [
  { from: 'ui', allow: ['ui', 'application', 'domain'] },
  { from: 'application', allow: ['application', 'domain', 'repositories'] },
  { from: 'domain', allow: ['domain'] },
  { from: 'repositories', allow: ['repositories', 'domain'] },
  { from: 'infrastructure', allow: ['infrastructure', 'repositories', 'domain'] },
  { from: 'root', allow: ['root', 'ui', 'application', 'domain', 'repositories', 'infrastructure'] },
];

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries, 'react-hooks': reactHooks },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'ui', pattern: 'src/ui/**', mode: 'full' },
        { type: 'application', pattern: 'src/application/**', mode: 'full' },
        { type: 'domain', pattern: 'src/domain/**', mode: 'full' },
        { type: 'repositories', pattern: 'src/repositories/**', mode: 'full' },
        { type: 'infrastructure', pattern: 'src/infrastructure/**', mode: 'full' },
        { type: 'root', pattern: 'src/*', mode: 'full' },
      ],
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // «const { repeat, ...rest } = draft» — отбрасывание поля без лишней переменной.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'boundaries/no-unknown-files': 'error',
      'boundaries/element-types': ['error', { default: 'disallow', rules: layerRules }],
      // Domain не зависит ни от чего, кроме date-fns (п. 14.2).
      'boundaries/external': [
        'error',
        {
          default: 'allow',
          rules: [
            { from: ['domain'], disallow: ['*'] },
            { from: ['domain'], allow: ['date-fns'] },
            { from: ['ui', 'application', 'domain', 'repositories'], disallow: ['dexie', 'fake-indexeddb'] },
          ],
        },
      ],
      // Пользовательский ввод — только как текст (п. 15.1).
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Запрещено: п. 15.1 ТЗ' },
        { selector: "AssignmentExpression[left.property.name='innerHTML']", message: 'Запрещено: п. 15.1 ТЗ' },
        // Текущее время — только через Clock (п. 10.2), чтобы тесты управляли временем.
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Используйте Clock' },
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Используйте Clock' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'indexedDB', message: 'IndexedDB доступна только в слое Infrastructure' },
      ],
    },
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['src/infrastructure/SystemClock.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
