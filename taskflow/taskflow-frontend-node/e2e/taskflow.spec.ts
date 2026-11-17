import { expect, test, type Page } from '@playwright/test';

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function register(page: Page, name: string) {
  const email = `${unique()}@e2e.test`;
  await page.goto('/register');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your first world' })).toBeVisible();
  return email;
}

async function createBoard(page: Page) {
  const slug = `e2e-${unique()}`;
  await page.getByRole('button', { name: 'New workspace' }).click();
  await page.getByLabel('Name').fill('E2E Space');
  await page.getByLabel('Slug').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Launch Pad');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('region', { name: 'To Do' })).toBeVisible();
}

test('sign up, build a board, and work a task through it', async ({ page }) => {
  await register(page, 'Ada Lovelace');
  await createBoard(page);

  await page.getByLabel('New task title').fill('Ship the orbit board');
  await page.getByRole('button', { name: 'Add task' }).click();
  const todo = page.getByRole('region', { name: 'To Do' });
  await expect(todo.getByText('Ship the orbit board')).toBeVisible();

  await page.getByRole('button', { name: 'Move LP-1 forward' }).click();
  await expect(
    page.getByRole('region', { name: 'In Progress' }).getByText('Ship the orbit board'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Ship the orbit board' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Priority').selectOption('urgent');
  await dialog.getByLabel('Add a comment').fill('Looks great in 3D');
  await dialog.getByRole('button', { name: 'Comment' }).click();
  await expect(dialog.getByText('Looks great in 3D')).toBeVisible();
  await dialog.getByRole('tab', { name: 'activity' }).click();
  await expect(dialog.getByText(/updated priority/)).toBeVisible();

  // The access token lives in memory only: a reload must restore it from the refresh cookie.
  await page.reload();
  await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Ship the orbit board');
});

test('drag and drop moves a card between columns', async ({ page }) => {
  await register(page, 'Grace Hopper');
  await createBoard(page);
  await page.getByLabel('New task title').fill('Drag me');
  await page.getByRole('button', { name: 'Add task' }).click();

  await page
    .getByRole('button', { name: 'Flat view' })
    .or(page.getByRole('button', { name: '3D view' }))
    .click();
  await page.getByTestId('task-LP-1').dragTo(page.getByRole('region', { name: 'Done' }));
  await expect(page.getByRole('region', { name: 'Done' }).getByText('Drag me')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Done' }).getByText('Drag me')).toBeVisible();
});

test('a second tab sees changes live over the WebSocket', async ({ page, context }) => {
  await register(page, 'Katherine Johnson');
  await createBoard(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByText('Live')).toBeVisible();

  await page.getByLabel('New task title').fill('Appears everywhere');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(
    other.getByRole('region', { name: 'To Do' }).getByText('Appears everywhere'),
  ).toBeVisible();
});

test('search finds a task and opens it', async ({ page }) => {
  await register(page, 'Mary Jackson');
  await createBoard(page);
  await page.getByLabel('New task title').fill('Calibrate the telescope');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Calibrate the telescope')).toBeVisible();

  await page.getByLabel('Search tasks').fill('telescope');
  await page.getByRole('list', { name: 'Search results' }).getByRole('link').first().click();
  await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Calibrate the telescope');
});
