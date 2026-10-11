import { createProfile, expect, test } from './fixtures';

// Отклик (п. 15.2): ≤ 100 мс от действия до видимого изменения, INP ≤ 200 мс. Performance API — только в Chromium.
test.describe('отклик на добавление и отметку (п. 15.2)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Event Timing API — в Chromium');

  test('@perf добавление задачи и отметки задачи и привычки: ≤ 100 мс до изменения, INP ≤ 200 мс', async ({ page }) => {
    await createProfile(page);
    // Привычка для отметки.
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Привычки' }).click();
    await page.getByRole('button', { name: 'Создать первую привычку' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новая привычка' });
    await dialog.getByLabel('Название').fill('Вода');
    await dialog.getByRole('button', { name: 'Создать' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Сегодня' }).click();

    await page.evaluate(() => {
      const w = window as unknown as { __inp: number[] };
      w.__inp = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__inp.push(e.duration);
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    });

    /** Время от действия до появления условия в DOM (MutationObserver в странице). */
    const timeTo = (action: string, until: string) =>
      page.evaluate(
        ({ action, until }) =>
          new Promise<number>((resolveTime) => {
            const check = new Function(`return (${until})`) as () => boolean;
            const start = performance.now();
            const observer = new MutationObserver(() => {
              if (check()) {
                observer.disconnect();
                resolveTime(performance.now() - start);
              }
            });
            observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
            (new Function(action) as () => void)();
          }),
        { action, until },
      );

    const results: Record<string, number[]> = { add: [], task: [], habit: [] };
    for (let i = 0; i < 4; i++) {
      await page.getByLabel('Новая задача').fill(`Задача ${i}`);
      results.add!.push(
        await timeTo(
          `document.querySelector('form[aria-label="Быстрое добавление задачи"]').requestSubmit()`,
          `[...document.querySelectorAll('[data-testid="task"]')].some((li) => li.textContent.includes('Задача ${i}'))`,
        ),
      );
      results.task!.push(
        await timeTo(
          `[...document.querySelectorAll('[data-testid="task"]')].find((li) => li.textContent.includes('Задача ${i}')).querySelector('input[type="checkbox"]').click()`,
          `[...document.querySelectorAll('[data-testid="task"]')].some((li) => li.textContent.includes('Задача ${i}') && li.querySelector('input:checked'))`,
        ),
      );
      results.habit!.push(
        await timeTo(
          `document.querySelector('.today-habit button[aria-pressed]').click()`,
          `document.querySelector('.today-habit button[aria-pressed="true"]') !== null`,
        ),
      );
      await page.locator('.today-habit button[aria-pressed]').first().click();
      await expect(page.locator('.today-habit button[aria-pressed="true"]')).toHaveCount(0);
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const inp = Math.max(0, ...(await page.evaluate(() => (window as unknown as { __inp: number[] }).__inp)));
    console.log(
      `Отклик, мс: добавление ${results.add!.map((x) => x.toFixed(0)).join(', ')}; отметка задачи ${results.task!.map((x) => x.toFixed(0)).join(', ')}; отметка привычки ${results.habit!.map((x) => x.toFixed(0)).join(', ')}; INP ≈ ${inp.toFixed(0)}`,
    );
    for (const [name, xs] of Object.entries(results)) expect(median(xs), name).toBeLessThanOrEqual(100);
    expect(inp).toBeLessThanOrEqual(200);
  });
});
