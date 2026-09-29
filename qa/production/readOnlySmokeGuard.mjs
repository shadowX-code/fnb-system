// Production smoke must identify the business row before selecting a read action.
// Fail closed if layout, identity, or hit testing is ambiguous.
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function clickRowScopedView(tab, identity, actionName = 'View') {
  if (typeof identity !== 'string' || !identity.trim()) throw new Error('A business identity is required');
  if (actionName !== 'View') throw new Error('Only the read-only View action is permitted');

  const row = tab.playwright.getByRole('row', {
    name: new RegExp(`^${escapeRegExp(identity)}(?:\\s|$)`),
  });
  if (await row.count() !== 1) throw new Error(`Expected one row for ${identity}`);

  const view = row.getByRole('button', { name: actionName, exact: true });
  if (await view.count() !== 1) throw new Error(`Expected one View action for ${identity}`);

  const safe = await view.evaluate((button, expectedIdentity) => {
    const cells = button.closest('tr')?.querySelectorAll('td');
    const firstCell = cells?.[0]?.textContent?.trim();
    const bounds = button.getBoundingClientRect();
    const target = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    return firstCell === expectedIdentity
      && button.textContent?.trim() === 'View'
      && bounds.width > 0
      && bounds.height > 0
      && target?.closest('button') === button;
  }, identity);
  if (!safe) throw new Error(`View target for ${identity} is not safely clickable`);

  await view.click();
}
