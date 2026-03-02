import { test, expect } from '@playwright/test';

test('Full ERP Lifecycle: Buy, Make, Sell', async ({ page }) => {
  // 1. LOGIN
  await page.goto('/login');
  
  // Wait for the initial "SYSTEM_CHECK..." loading state to disappear
  await page.waitForSelector('text=SYSTEM_CHECK...', { state: 'hidden', timeout: 15000 });

  await page.getByTestId('username-input').fill('admin');
  await page.getByTestId('password-input').fill('password');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL('/dashboard', { timeout: 15000 });

  // --- UNIQUE IDENTIFIERS ---
  const timestamp = Date.now();
  const supplierName = `Supplier-${timestamp}`;
  const customerName = `Customer-${timestamp}`;
  const rmA = `RM-A-${timestamp}`;
  const rmB = `RM-B-${timestamp}`;
  const fgX = `FG-X-${timestamp}`;
  const poNum = `PO-${timestamp}`;
  const soNum = `SO-${timestamp}`;

  // 2. SETUP PARTNERS
  await page.goto('/suppliers');
  await page.click('button:has-text("Add Supplier")');
  await page.fill('input[placeholder*="supplier name"]', supplierName);
  await page.click('button:has-text("CREATE SUPPLIER")');
  await expect(page.locator(`text=${supplierName}`)).toBeVisible();

  await page.goto('/customers');
  await page.click('button:has-text("Add Customer")');
  await page.fill('input[placeholder*="customer name"]', customerName);
  await page.click('button:has-text("CREATE CUSTOMER")');
  await expect(page.locator(`text=${customerName}`)).toBeVisible();

  // 3. INVENTORY (Raw Materials & FG)
  await page.goto('/inventory');
  
  // Create RM-A
  await page.getByTestId('create-item-btn').click();
  await expect(page.getByTestId('create-item-modal')).toBeVisible();
  
  await page.getByTestId('item-code-input').fill(rmA);
  await page.getByTestId('item-name-input').fill('Raw Material A');
  // Use new reliable testids
  await page.getByTestId('category-select').selectOption({ label: 'Raw Material' }); 
  await page.getByTestId('uom-select').selectOption({ label: 'kg' });
  
  await page.getByTestId('submit-create-item').click();
  await expect(page.getByTestId('create-item-modal')).toBeHidden();

  // Create RM-B
  await page.getByTestId('create-item-btn').click();
  await expect(page.getByTestId('create-item-modal')).toBeVisible();
  
  await page.getByTestId('item-code-input').fill(rmB);
  await page.getByTestId('item-name-input').fill('Raw Material B');
  await page.getByTestId('category-select').selectOption({ label: 'Raw Material' });
  await page.getByTestId('uom-select').selectOption({ label: 'kg' });
  
  await page.getByTestId('submit-create-item').click();
  await expect(page.getByTestId('create-item-modal')).toBeHidden();

  // Create FG-X
  await page.getByTestId('create-item-btn').click();
  await expect(page.getByTestId('create-item-modal')).toBeVisible();
  
  await page.getByTestId('item-code-input').fill(fgX);
  await page.getByTestId('item-name-input').fill('Finished Good X');
  
  await page.getByTestId('category-select').selectOption({ label: 'Finished Goods' });
  await page.getByTestId('uom-select').selectOption({ label: 'kg' });

  // Select all attributes (check all checkboxes in the attributes section)
  const attributeCheckboxes = page.locator('.modal-body .form-check-input');
  const count = await attributeCheckboxes.count();
  for (let i = 0; i < count; ++i) {
    await attributeCheckboxes.nth(i).check();
  }

  await page.getByTestId('submit-create-item').click();
  await expect(page.getByTestId('create-item-modal')).toBeHidden();

  // 4. ENGINEERING (BOM)
  await page.goto('/bom');
  await page.click('button:has-text("Create BOM")');
  
  // Select FG-X
  await page.click('text=Select Item...'); 
  await page.fill('input[placeholder="Search..."]', fgX);
  await page.click(`text=${fgX}`);
  
  // Add RM-A (0.5)
  await page.click('text=Select Material...');
  await page.fill('input[placeholder="Search..."]', rmA);
  await page.click(`text=${rmA}`);
  await page.fill('input[type="number"]', '0.5');
  await page.click('button:has-text("Add Line")');

  // Add RM-B (0.5)
  await page.click('text=Select Material...'); 
  await page.fill('input[placeholder="Search..."]', rmB);
  await page.click(`text=${rmB}`);
  await page.fill('input[type="number"]', '0.5');
  await page.click('button:has-text("Add Line")');

  await page.click('button:has-text("Save Recipe")');

  // 5. PROCUREMENT (Purchase Order)
  await page.goto('/purchase-orders');
  await page.click('button:has-text("Create")');
  await page.fill('input[placeholder="Auto-generated"]', poNum);
  
  // Select Supplier
  await page.click('text=Select Supplier...');
  await page.fill('input[placeholder="Search..."]', supplierName);
  await page.click(`text=${supplierName}`);

  // Select Warehouse
  await page.click('text=Select...'); 
  await page.locator('div.dropdown-menu.show').getByText(/[A-Z]+/).first().click();

  // Add Line: RM-A
  await page.click('text=Select Item...');
  await page.fill('input[placeholder="Search..."]', rmA);
  await page.click(`text=${rmA}`);
  await page.fill('input[placeholder="0"]', '100');
  await page.click('button:has-text("Add")');

  // Add Line: RM-B
  await page.click('text=Select Item...');
  await page.fill('input[placeholder="Search..."]', rmB);
  await page.click(`text=${rmB}`);
  await page.fill('input[placeholder="0"]', '100');
  await page.click('button:has-text("Add")');

  await page.click('button:has-text("Save PO")');

  // Receive PO
  await page.click('button:has-text("Receive")');
  await expect(page.locator('text=RECEIVED')).toBeVisible();

  // 6. SALES (Sales Order)
  await page.goto('/sales-orders');
  await page.click('button:has-text("Create")');
  await page.fill('input[placeholder="Auto-generated"]', soNum);

  // Select Customer
  await page.click('text=Select Customer...');
  await page.fill('input[placeholder="Search..."]', customerName);
  await page.click(`text=${customerName}`);

  // Add Line: FG-X (Qty 10)
  await page.click('text=Select Item...');
  await page.fill('input[placeholder="Search..."]', fgX);
  await page.click(`text=${fgX}`);
  
  // Select attributes for FG-X if prompted (handle dynamic attribute dropdowns)
  const attributeSelects = page.locator('.bg-light.p-3 select.form-select-sm');
  const attrCount = await attributeSelects.count();
  for (let i = 0; i < attrCount; ++i) {
      await attributeSelects.nth(i).selectOption({ index: 1 });
  }

  await page.fill('input[placeholder="0"]', '10');
  await page.click('button:has-text("Add")');

  await page.click('button:has-text("Save Order")');

  // 7. PRODUCTION
  await page.click('button:has-text("PRODUCE")');
  await expect(page).toHaveURL(/\/manufacturing/);
  
  // Select Target Location
  await page.locator('select').nth(0).selectOption({ index: 1 });
  await page.click('button:has-text("CREATE WORK ORDER")');

  // 8. EXECUTION
  await page.click('button:has-text("START")');
  await expect(page.locator('text=IN_PROGRESS')).toBeVisible();

  await page.click('button:has-text("FINISH")');
  await expect(page.locator('text=COMPLETED')).toBeVisible();
});
