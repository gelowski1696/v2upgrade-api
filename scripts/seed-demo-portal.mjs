import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { PrismaClient } from '../dist/generated/prisma/client.js';

const DEMO_CLIENT_CODE = 'DEMO-MULTI-STORE';
const DEMO_CLIENT_MARKER = '[VMJAM_DEMO_SEED]';
const SCHEMA_VERSION = 27;
const APPLICATION_VERSION = 'demo-1.0.0';
const SNAPSHOT_DAYS = 90;

const stores = [
  {
    code: 'DEMO-DOWNTOWN',
    name: 'VMJAM Downtown',
    viewer: 'demo.downtown@vmjam.local',
    viewerName: 'Downtown Store Viewer',
    multiplier: 1.35,
    stockBias: 10,
  },
  {
    code: 'DEMO-RIVERSIDE',
    name: 'VMJAM Riverside',
    viewer: 'demo.riverside@vmjam.local',
    viewerName: 'Riverside Store Viewer',
    multiplier: 0.9,
    stockBias: 4,
  },
  {
    code: 'DEMO-NORTH-HUB',
    name: 'VMJAM North Hub',
    viewer: 'demo.northhub@vmjam.local',
    viewerName: 'North Hub Store Viewer',
    multiplier: 1.15,
    stockBias: 7,
  },
  {
    code: 'DEMO-MARKET',
    name: 'VMJAM Market Square',
    viewer: 'demo.market@vmjam.local',
    viewerName: 'Market Square Store Viewer',
    multiplier: 0.72,
    stockBias: -3,
  },
  {
    code: 'DEMO-AIRPORT',
    name: 'VMJAM Airport',
    viewer: 'demo.airport@vmjam.local',
    viewerName: 'Airport Store Viewer',
    multiplier: 1.55,
    stockBias: 13,
  },
];

const products = [
  {
    code: 'LPG-11',
    name: 'LPG Cylinder',
    size: '11 kg',
    category: 'LPG',
    cost: 760,
    refill: 930,
    nonRefill: 2380,
    alert: 8,
  },
  {
    code: 'LPG-22',
    name: 'LPG Cylinder',
    size: '22 kg',
    category: 'LPG',
    cost: 1450,
    refill: 1775,
    nonRefill: 3950,
    alert: 5,
  },
  {
    code: 'LPG-50',
    name: 'LPG Cylinder',
    size: '50 kg',
    category: 'LPG',
    cost: 3230,
    refill: 3890,
    nonRefill: 7100,
    alert: 3,
  },
  {
    code: 'REG-STD',
    name: 'Standard Regulator',
    size: '-',
    category: 'Accessories',
    cost: 290,
    refill: 0,
    nonRefill: 475,
    alert: 6,
  },
  {
    code: 'HOSE-15',
    name: 'LPG Hose 1.5m',
    size: '-',
    category: 'Accessories',
    cost: 115,
    refill: 0,
    nonRefill: 210,
    alert: 10,
  },
  {
    code: 'CLAMP-02',
    name: 'Safety Hose Clamp',
    size: '-',
    category: 'Accessories',
    cost: 22,
    refill: 0,
    nonRefill: 50,
    alert: 15,
  },
  {
    code: 'WATER-5G',
    name: 'Purified Water',
    size: '5 gal',
    category: 'Water',
    cost: 24,
    refill: 45,
    nonRefill: 195,
    alert: 12,
  },
  {
    code: 'BURNER-01',
    name: 'Single Burner Stove',
    size: '-',
    category: 'Appliances',
    cost: 620,
    refill: 0,
    nonRefill: 890,
    alert: 4,
  },
];

const STORE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE categorytbl (
  catid INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,
  catdate TEXT,
  cattype INTEGER,
  catmonitor TEXT DEFAULT 'N',
  csv TEXT DEFAULT 'N'
);

CREATE TABLE inventorytbl (
  itemid INTEGER PRIMARY KEY AUTOINCREMENT,
  itemcode TEXT,
  itembrand TEXT,
  itemname TEXT,
  itemsize TEXT,
  itemqty INTEGER DEFAULT 0,
  itemcost REAL DEFAULT 0,
  itemmarkrup INTEGER,
  itemsellprice REAL,
  itemdate TEXT,
  itemcategory TEXT,
  icount INTEGER DEFAULT 0,
  variance INTEGER,
  countdate TEXT,
  itemsupp TEXT,
  itemimg BLOB,
  locationitem TEXT,
  itemdateofdel TEXT,
  iteminvoicenum TEXT,
  alertnum INTEGER DEFAULT 0,
  fillqty INTEGER DEFAULT 0,
  emptyqty INTEGER DEFAULT 0,
  whqty INTEGER DEFAULT 0,
  whempty INTEGER DEFAULT 0,
  whfill INTEGER DEFAULT 0,
  lendqty INTEGER DEFAULT 0,
  whdispose INTEGER DEFAULT 0
);

CREATE TABLE pricelisttbl (
  priceid INTEGER PRIMARY KEY AUTOINCREMENT,
  Refill REAL DEFAULT 0,
  Non_Refill REAL DEFAULT 0,
  itemid INTEGER,
  Online REAL DEFAULT 0,
  Cost REAL DEFAULT 0
);

CREATE TABLE salestbl (
  salesid INTEGER PRIMARY KEY AUTOINCREMENT,
  salesrefnum TEXT,
  salescust TEXT,
  salescustadd TEXT,
  salescustcont TEXT,
  salespaym TEXT,
  salescashier TEXT,
  salestotalitem INTEGER DEFAULT 0,
  salessub REAL,
  salesvat REAL,
  salestotalamount REAL,
  saleschange REAL,
  salesremarks TEXT,
  salesdate TEXT,
  salestender REAL,
  salescreditpaid REAL,
  salescreditbal TEXT DEFAULT 'N',
  salestatus TEXT,
  salesdisc REAL,
  bankrefnum TEXT,
  bankname TEXT,
  Custbankname TEXT,
  salescat TEXT,
  salescustid INTEGER,
  salespaytype TEXT,
  tenderbalance REAL DEFAULT 0,
  tendertotal REAL DEFAULT 0,
  salestotalcost REAL DEFAULT 0,
  totallend INTEGER DEFAULT 0,
  salesdelby TEXT,
  salesdelid INTEGER,
  salesdelsal REAL DEFAULT 0,
  salesdelid2 INTEGER,
  salesdelby2 TEXT,
  specialdisc REAL DEFAULT 0,
  paydate TEXT,
  spreceipt TEXT NOT NULL DEFAULT 'N'
);

CREATE TABLE salescart (
  scid INTEGER PRIMARY KEY AUTOINCREMENT,
  screfnum TEXT,
  scdate TEXT,
  scitemcode TEXT,
  scitemdesc TEXT,
  scunit TEXT,
  scprice REAL,
  sctotal REAL,
  scqty INTEGER DEFAULT 0,
  sccashier TEXT,
  scdiscount REAL,
  scstats TEXT,
  scbrand TEXT,
  scpackage TEXT,
  sccost REAL DEFAULT 0,
  totalcost REAL DEFAULT 0,
  sclendqty INTEGER DEFAULT 0,
  sclendstats TEXT
);

CREATE TABLE custinfo (
  custid INTEGER PRIMARY KEY AUTOINCREMENT,
  custname TEXT,
  custcontnum TEXT,
  custadd TEXT,
  custemail TEXT,
  custdate TEXT,
  creditlimit REAL,
  custcode TEXT,
  custpoints INTEGER DEFAULT 0,
  customercat TEXT,
  custtotal REAL DEFAULT 0,
  custbalance REAL DEFAULT 0,
  custsales REAL DEFAULT 0,
  ribalance REAL DEFAULT 0,
  totalri REAL DEFAULT 0,
  lendqty INTEGER DEFAULT 0,
  custstatus TEXT DEFAULT 'active'
);

CREATE TABLE customer_groups (
  group_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  range_discount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  loyalty_eligible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE customer_group_members (
  customer_id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  assigned_at TEXT NOT NULL
);

CREATE TABLE creditpaymenttbl (
  cpid INTEGER PRIMARY KEY AUTOINCREMENT,
  cprefnum TEXT,
  cpcustname TEXT,
  cpcustcat TEXT,
  cpbalance REAL DEFAULT 0,
  cppay REAL DEFAULT 0,
  cppaydate TEXT,
  cpcustid INTEGER,
  cprembal REAL DEFAULT 0,
  cpremarks TEXT,
  cpcashier TEXT,
  ri REAL DEFAULT 0,
  usedri REAL DEFAULT 0,
  cppaymethod TEXT,
  creditpid INTEGER
);

CREATE TABLE pouttbl (
  poutid INTEGER PRIMARY KEY AUTOINCREMENT,
  poutrefnum TEXT,
  pulldate TEXT,
  pullsupplier TEXT,
  pouttranstype TEXT,
  pouttransto TEXT,
  pouttotalqty INTEGER DEFAULT 0,
  pouttotalamount REAL,
  poutencoder TEXT,
  pulloutremarks TEXT,
  pouttype TEXT,
  restockprice REAL DEFAULT 0,
  ponum TEXT,
  serial TEXT,
  poutpid INTEGER,
  notes TEXT,
  invoice_reference TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  payment_reference TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  no_charge_reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE pulloutcart (
  pid INTEGER PRIMARY KEY AUTOINCREMENT,
  poutref TEXT,
  poutdate TEXT,
  poutencoder TEXT,
  poutitemcode TEXT,
  poutitemname TEXT,
  poutqty INTEGER DEFAULT 0,
  poutcost REAL,
  poutotal REAL,
  poutremarks TEXT,
  poutto TEXT,
  poutsupplier TEXT,
  poutbrand TEXT,
  poutpackage TEXT,
  pouttype TEXT
);

CREATE TABLE supplier_restock_payments (
  payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL,
  payment_reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  payment_kind TEXT NOT NULL DEFAULT 'PAYMENT'
);

CREATE TABLE personeltbl (
  pid INTEGER PRIMARY KEY AUTOINCREMENT,
  pname TEXT,
  paddress TEXT,
  pcontactnum TEXT,
  prole TEXT,
  ptrans INTEGER DEFAULT 0,
  ptotalpay REAL DEFAULT 0,
  pcreatedate TEXT,
  ptotalsalary REAL DEFAULT 0,
  pcard TEXT
);

CREATE TABLE invetorycounttbl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  itemcode TEXT,
  itemdesc TEXT,
  fillqty INTEGER DEFAULT 0,
  emptyqty INTEGER DEFAULT 0,
  date TEXT,
  location TEXT,
  whfillqty INTEGER DEFAULT 0,
  whemptyqty INTEGER DEFAULT 0,
  category TEXT
);

CREATE TABLE itemhistorytbl (
  itemhid INTEGER PRIMARY KEY AUTOINCREMENT,
  itemhdate TEXT,
  itemhitemc TEXT,
  itemhrefnum TEXT,
  itemhorigin TEXT,
  itemhqty INTEGER,
  itemhremarks TEXT,
  itemhfromqty INTEGER,
  itemhtoqty INTEGER
);

CREATE TABLE disposehistory (
  disid INTEGER PRIMARY KEY AUTOINCREMENT,
  disitemcode TEXT,
  disitemdesc TEXT,
  disqty INTEGER DEFAULT 0,
  disremarks TEXT,
  disdate TEXT,
  disby TEXT,
  DisposeNote TEXT
);

CREATE TABLE inventory_cost_receipts (
  receipt_id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL,
  transfer_line_id INTEGER NOT NULL UNIQUE,
  transfer_reference TEXT NOT NULL,
  itemid INTEGER NOT NULL,
  itemcode TEXT NOT NULL,
  location TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  previous_quantity INTEGER NOT NULL DEFAULT 0,
  previous_average_cost REAL NOT NULL DEFAULT 0,
  new_average_cost REAL NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL DEFAULT '',
  invoice_reference TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT NOT NULL
);

CREATE TABLE inventory_adjustments (
  adjustment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  itemid INTEGER NOT NULL,
  unit TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  remarks TEXT NOT NULL DEFAULT '',
  adjusted_by TEXT NOT NULL,
  adjusted_at TEXT NOT NULL
);

CREATE TABLE pettylogstbl (
  pettylogid INTEGER PRIMARY KEY AUTOINCREMENT,
  pettylogdate TEXT,
  pettylogamount REAL DEFAULT 0,
  pettyorigamount REAL DEFAULT 0,
  pettylogby TEXT,
  pettylogtype TEXT,
  pettylogremarks TEXT,
  pettypaymenthod TEXT DEFAULT '',
  pettycatid INTEGER,
  pettyref TEXT
);

CREATE TABLE salhistory (
  salhid INTEGER PRIMARY KEY AUTOINCREMENT,
  salpersonel TEXT,
  salpersonelid INTEGER,
  salpaid REAL,
  saldate TEXT,
  salpaidby TEXT,
  salremarks TEXT,
  saltotal REAL,
  salbalance REAL,
  saldailypay REAL DEFAULT 0,
  saladdpay REAL DEFAULT 0,
  sallesspay REAL DEFAULT 0,
  salincentive REAL DEFAULT 0,
  salrefnum TEXT,
  salrefdate TEXT,
  salpaymethod TEXT
);

CREATE TABLE owner_feature_mods (
  feature_key TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL,
  config_version INTEGER NOT NULL,
  captured_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_sales_history_date ON salestbl(salesdate);
CREATE INDEX idx_salescart_reference ON salescart(screfnum);
CREATE INDEX idx_inventory_itemcode ON inventorytbl(itemcode);
CREATE INDEX idx_inventory_count_date ON invetorycounttbl(date);
CREATE INDEX idx_transfer_date ON pouttbl(pulldate);
`;

function isoDateTime(daysAgo, hour = 10, minute = 0) {
  const value = new Date();
  value.setUTCHours(hour, minute, 0, 0);
  value.setUTCDate(value.getUTCDate() - daysAgo);
  return value.toISOString().replace('T', ' ').slice(0, 19);
}

function isoDate(daysAgo) {
  return isoDateTime(daysAgo).slice(0, 10);
}

function money(value) {
  return Math.round(value * 100) / 100;
}

function generatedPassword() {
  return `Vm!${randomBytes(18).toString('base64url')}`;
}

function configuredPassword(name) {
  const value = process.env[name]?.trim() || generatedPassword();
  if (value.length < 12) {
    throw new Error(`${name} must contain at least 12 characters.`);
  }
  return value;
}

function ensureSnapshotPath(root, storeId) {
  const path = resolve(root, 'stores', storeId, 'snapshots');
  if (!path.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error('Refusing to write outside STORE_SNAPSHOT_ROOT.');
  }
  return path;
}

function createStoreSnapshot(filePath, storeIndex) {
  const profile = stores[storeIndex];
  const db = new Database(filePath);
  db.pragma('journal_mode = DELETE');
  db.exec(STORE_SCHEMA_SQL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);

  const seed = db.transaction(() => {
    const migration = db.prepare(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    );
    for (let version = 1; version <= SCHEMA_VERSION; version += 1) {
      migration.run(version, isoDateTime(SNAPSHOT_DAYS));
    }

    const category = db.prepare(
      'INSERT INTO categorytbl (category, catdate, cattype, catmonitor, csv) VALUES (?, ?, 1, ?, ?)',
    );
    category.run('LPG', isoDateTime(SNAPSHOT_DAYS), 'Y', 'Y');
    category.run('Accessories', isoDateTime(SNAPSHOT_DAYS), 'Y', 'Y');
    category.run('Water', isoDateTime(SNAPSHOT_DAYS), 'Y', 'Y');
    category.run('Appliances', isoDateTime(SNAPSHOT_DAYS), 'Y', 'Y');

    const personnel = db.prepare(
      `INSERT INTO personeltbl
       (pname, paddress, pcontactnum, prole, ptrans, ptotalpay, pcreatedate, ptotalsalary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    personnel.run(
      'Alex Driver',
      `${profile.name} service area`,
      '09170000001',
      'Driver',
      1,
      0,
      isoDateTime(SNAPSHOT_DAYS),
      18500,
    );
    personnel.run(
      'Jamie Cashier',
      `${profile.name} service area`,
      '09170000002',
      'Cashier',
      0,
      0,
      isoDateTime(SNAPSHOT_DAYS),
      17500,
    );
    personnel.run(
      'Morgan Helper',
      `${profile.name} service area`,
      '09170000003',
      'Helper',
      0,
      0,
      isoDateTime(SNAPSHOT_DAYS),
      15000,
    );

    const inventory = db.prepare(
      `INSERT INTO inventorytbl
       (itemid, itemcode, itembrand, itemname, itemsize, itemqty, itemcost,
        itemsellprice, itemdate, itemcategory, alertnum, fillqty, emptyqty,
        whfill, whempty, lendqty, itemsupp, locationitem)
       VALUES (@id, @code, 'VMJAM', @name, @size, @quantity, @cost,
        @sellingPrice, @date, @category, @alert, @fill, @empty,
        @warehouseFill, @warehouseEmpty, @lent, 'Demo Gas Supply', 'STORE')`,
    );
    const price = db.prepare(
      'INSERT INTO pricelisttbl (Refill, Non_Refill, itemid, Online, Cost) VALUES (?, ?, ?, ?, ?)',
    );
    products.forEach((product, productIndex) => {
      const rawFill =
        16 + profile.stockBias + ((productIndex * 7 + storeIndex * 3) % 19);
      const fill =
        storeIndex === 3 && productIndex < 2
          ? productIndex
          : Math.max(0, rawFill);
      const empty = 4 + ((productIndex + storeIndex * 2) % 11);
      inventory.run({
        id: productIndex + 1,
        code: product.code,
        name: product.name,
        size: product.size,
        quantity: fill + empty,
        cost: product.cost,
        sellingPrice: product.refill || product.nonRefill,
        date: isoDateTime(SNAPSHOT_DAYS),
        category: product.category,
        alert: product.alert,
        fill,
        empty,
        warehouseFill: Math.max(2, Math.round(fill * 0.45)),
        warehouseEmpty: Math.max(1, Math.round(empty * 0.35)),
        lent:
          product.category === 'LPG'
            ? 1 + ((storeIndex + productIndex) % 4)
            : 0,
      });
      price.run(
        product.refill,
        product.nonRefill,
        productIndex + 1,
        money(product.nonRefill * 1.03),
        product.cost,
      );
    });

    const group = db.prepare(
      'INSERT INTO customer_groups (name, range_discount, created_at, updated_at, loyalty_eligible) VALUES (?, ?, ?, ?, 1)',
    );
    group.run('Households', 0, isoDateTime(SNAPSHOT_DAYS), isoDateTime(0));
    group.run(
      'Business Accounts',
      3,
      isoDateTime(SNAPSHOT_DAYS),
      isoDateTime(0),
    );

    const customer = db.prepare(
      `INSERT INTO custinfo
       (custid, custname, custcontnum, custadd, custemail, custdate, creditlimit,
        custcode, custpoints, customercat, custtotal, custbalance, custsales, custstatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    );
    const member = db.prepare(
      'INSERT INTO customer_group_members (customer_id, group_id, assigned_at) VALUES (?, ?, ?)',
    );
    for (let id = 1; id <= 6; id += 1) {
      const balance =
        id % 3 === 0 ? money((900 + id * 310) * profile.multiplier) : 0;
      customer.run(
        id,
        `${profile.name.replace('VMJAM ', '')} Customer ${id}`,
        `0918${storeIndex}${String(id).padStart(6, '0')}`,
        `${id} Demo Street`,
        `customer${id}.${profile.code.toLowerCase()}@example.test`,
        isoDateTime(SNAPSHOT_DAYS),
        id > 3 ? 15000 : 5000,
        `${profile.code}-C${String(id).padStart(3, '0')}`,
        id * 25,
        id > 3 ? 'Business' : 'Household',
        money((22000 + id * 2100) * profile.multiplier),
        balance,
        money((22000 + id * 2100) * profile.multiplier),
      );
      member.run(id, id > 3 ? 2 : 1, isoDateTime(SNAPSHOT_DAYS));
    }

    const sale = db.prepare(
      `INSERT INTO salestbl
       (salesid, salesrefnum, salescust, salescustadd, salescustcont, salespaym,
        salescashier, salestotalitem, salessub, salesvat, salestotalamount,
        saleschange, salesremarks, salesdate, salestender, salescreditpaid,
        salescreditbal, salestatus, salesdisc, salescat, salescustid,
        salespaytype, tenderbalance, tendertotal, salestotalcost, specialdisc,
        paydate, spreceipt)
       VALUES (@id, @reference, @customer, @address, @contact, @payment,
        'Jamie Cashier', @itemCount, @subtotal, 0, @total,
        @change, @remarks, @date, @tender, @creditPaid,
        @creditBalance, @status, @discount, @saleCategory, @customerId,
        @paymentType, @balance, @tenderTotal, @totalCost, @specialDiscount,
        @payDate, @specialReceipt)`,
    );
    const saleLine = db.prepare(
      `INSERT INTO salescart
       (screfnum, scdate, scitemcode, scitemdesc, scunit, scprice, sctotal,
        scqty, sccashier, scdiscount, scstats, scbrand, sccost, totalcost,
        sclendqty, sclendstats)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Jamie Cashier', ?, 'CONFIRMED',
        'VMJAM', ?, ?, 0, 'RETURNED')`,
    );
    const history = db.prepare(
      `INSERT INTO itemhistorytbl
       (itemhdate, itemhitemc, itemhrefnum, itemhorigin, itemhqty,
        itemhremarks, itemhfromqty, itemhtoqty)
       VALUES (?, ?, ?, 'PURCHASE ITEM', ?, 'Demo sale', ?, ?)`,
    );
    const creditPayment = db.prepare(
      `INSERT INTO creditpaymenttbl
       (cprefnum, cpcustname, cpcustcat, cpbalance, cppay, cppaydate,
        cpcustid, cprembal, cpremarks, cpcashier, cppaymethod)
       VALUES (?, ?, 'Business', ?, ?, ?, ?, ?, 'Demo collection', 'Jamie Cashier', ?)`,
    );

    let saleId = 1;
    for (let daysAgo = SNAPSHOT_DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
      const dailyCount = 2 + ((daysAgo + storeIndex) % 4);
      for (let transaction = 0; transaction < dailyCount; transaction += 1) {
        const productIndex =
          (daysAgo * 3 + transaction + storeIndex) % products.length;
        const product = products[productIndex];
        const quantity =
          1 + ((daysAgo + transaction) % (product.category === 'LPG' ? 3 : 5));
        const unitPrice = product.refill || product.nonRefill;
        const gross = money(unitPrice * quantity * profile.multiplier);
        const discount = saleId % 11 === 0 ? money(gross * 0.05) : 0;
        const specialDiscount = saleId % 37 === 0 ? money(gross * 0.2) : 0;
        const total = money(gross - discount - specialDiscount);
        const totalCost = money(product.cost * quantity * profile.multiplier);
        const customerId = 1 + ((saleId + storeIndex) % 6);
        const unpaid = daysAgo > 30 && saleId % 29 === 0;
        const payment = unpaid
          ? 'Credit'
          : ['Cash', 'GCash', 'Card'][saleId % 3];
        const balance = unpaid ? money(total * 0.65) : 0;
        const date = isoDateTime(
          daysAgo,
          8 + ((transaction * 2) % 10),
          (saleId * 7) % 60,
        );
        const reference = `${profile.code}-S${String(saleId).padStart(5, '0')}`;
        sale.run({
          id: saleId,
          reference,
          customer: `${profile.name.replace('VMJAM ', '')} Customer ${customerId}`,
          address: `${customerId} Demo Street`,
          contact: `0918${storeIndex}${String(customerId).padStart(6, '0')}`,
          payment,
          itemCount: quantity,
          subtotal: gross,
          total,
          change: 0,
          remarks: unpaid ? 'Demo account sale' : 'Demo completed sale',
          date,
          tender: unpaid ? money(total - balance) : total,
          creditPaid: unpaid ? money(total - balance) : 0,
          creditBalance: unpaid ? 'Y' : 'N',
          status: unpaid ? 'UNPAID' : 'CONFIRMED',
          discount,
          saleCategory: product.category,
          customerId,
          paymentType: payment,
          balance,
          tenderTotal: total,
          totalCost,
          specialDiscount,
          payDate: unpaid ? '' : date,
          specialReceipt: saleId % 17 === 0 ? 'Y' : 'N',
        });
        saleLine.run(
          reference,
          date,
          product.code,
          `${product.name} ${product.size}`,
          product.refill ? 'Refill' : 'Piece',
          money(unitPrice * profile.multiplier),
          total,
          quantity,
          money(discount + specialDiscount),
          money(product.cost * profile.multiplier),
          totalCost,
        );
        history.run(date, product.code, reference, quantity, 50, 50 - quantity);
        if (unpaid && saleId % 2 === 0) {
          creditPayment.run(
            reference,
            `${profile.name.replace('VMJAM ', '')} Customer ${customerId}`,
            total,
            money(total - balance),
            isoDateTime(Math.max(0, daysAgo - 5)),
            customerId,
            balance,
            payment,
          );
        }
        saleId += 1;
      }
    }

    const count = db.prepare(
      `INSERT INTO invetorycounttbl
       (itemcode, itemdesc, fillqty, emptyqty, date, location, whfillqty,
        whemptyqty, category)
       VALUES (?, ?, ?, ?, ?, 'STORE', ?, ?, ?)`,
    );
    for (let daysAgo = SNAPSHOT_DAYS; daysAgo >= 0; daysAgo -= 1) {
      products.forEach((product, productIndex) => {
        const base =
          13 +
          profile.stockBias +
          ((daysAgo + productIndex * 5 + storeIndex) % 22);
        const fill =
          storeIndex === 3 && productIndex < 2 && daysAgo < 5
            ? productIndex
            : Math.max(0, base);
        const empty = 3 + ((daysAgo + productIndex + storeIndex) % 10);
        count.run(
          product.code,
          `${product.name} ${product.size}`,
          fill,
          empty,
          isoDate(daysAgo),
          Math.max(1, Math.round(fill * 0.4)),
          Math.max(1, Math.round(empty * 0.3)),
          product.category,
        );
      });
    }

    const transfer = db.prepare(
      `INSERT INTO pouttbl
       (poutrefnum, pulldate, pullsupplier, pouttranstype, pouttransto,
        pouttotalqty, pouttotalamount, poutencoder, pulloutremarks, pouttype,
        restockprice, ponum, serial, poutpid, notes, invoice_reference,
        confirmed_at, paid_at, payment_method, payment_reference, payment_status)
       VALUES (?, ?, ?, 'SUPPLIER', ?, ?, ?, 'Demo Encoder', 'CONFIRMED', ?,
        ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const transferLine = db.prepare(
      `INSERT INTO pulloutcart
       (poutref, poutdate, poutencoder, poutitemcode, poutitemname, poutqty,
        poutcost, poutotal, poutremarks, poutto, poutsupplier, poutbrand,
        poutpackage, pouttype)
       VALUES (?, ?, 'Demo Encoder', ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?,
        'VMJAM', ?, ?)`,
    );
    const supplierPayment = db.prepare(
      `INSERT INTO supplier_restock_payments
       (transfer_id, amount, payment_method, payment_reference, notes,
        paid_at, recorded_by, created_at, payment_kind)
       VALUES (?, ?, ?, ?, ?, ?, 'Demo Encoder', ?, 'PAYMENT')`,
    );
    const receipt = db.prepare(
      `INSERT INTO inventory_cost_receipts
       (transfer_id, transfer_line_id, transfer_reference, itemid, itemcode,
        location, unit, quantity, unit_cost, line_total, previous_quantity,
        previous_average_cost, new_average_cost, supplier, invoice_reference,
        confirmed_by, confirmed_at)
       VALUES (?, ?, ?, ?, ?, 'STORE', 'FULL', ?, ?, ?, ?, ?, ?, ?, ?,
        'Demo Encoder', ?)`,
    );
    let transferId = 1;
    let transferLineId = 1;
    for (let week = 0; week < 13; week += 1) {
      const daysAgo = Math.min(SNAPSHOT_DAYS - 1, week * 7 + 2);
      const date = isoDateTime(daysAgo, 7, 30);
      const reference = `${profile.code}-R${String(week + 1).padStart(3, '0')}`;
      const fullProduct = products[week % 3];
      const fullQuantity = 8 + storeIndex * 2 + (week % 5);
      const emptyQuantity = 3 + ((week + storeIndex) % 6);
      const fullTotal = money(fullQuantity * fullProduct.cost);
      const emptyCost = 85 + (week % 3) * 10;
      const emptyTotal = money(emptyQuantity * emptyCost);
      const purchaseAmount = money(fullTotal + emptyTotal);
      const paidAmount =
        week % 4 === 0 ? money(purchaseAmount * 0.6) : purchaseAmount;
      const paymentStatus = paidAmount < purchaseAmount ? 'PARTIAL' : 'PAID';
      transfer.run(
        reference,
        date,
        'Demo Gas Supply',
        profile.name,
        fullQuantity + emptyQuantity,
        purchaseAmount,
        'RESTOCK IN',
        purchaseAmount,
        `PO-${profile.code}-${week + 1}`,
        `SERIAL-${storeIndex + 1}-${week + 1}`,
        'Demo full and empty cylinder delivery',
        `INV-${profile.code}-${week + 1}`,
        date,
        paidAmount === purchaseAmount ? date : '',
        'Bank Transfer',
        `PAY-${profile.code}-${week + 1}`,
        paymentStatus,
      );
      transferLine.run(
        reference,
        date,
        fullProduct.code,
        `${fullProduct.name} ${fullProduct.size}`,
        fullQuantity,
        fullProduct.cost,
        fullTotal,
        profile.name,
        'Demo Gas Supply',
        fullProduct.size,
        'RESTOCK INFILL',
      );
      const fullLineId = transferLineId;
      transferLineId += 1;
      transferLine.run(
        reference,
        date,
        fullProduct.code,
        `${fullProduct.name} ${fullProduct.size} Empty`,
        emptyQuantity,
        emptyCost,
        emptyTotal,
        profile.name,
        'Demo Gas Supply',
        fullProduct.size,
        'RESTOCK INEMPTY',
      );
      transferLineId += 1;
      supplierPayment.run(
        transferId,
        paidAmount,
        'Bank Transfer',
        `PAY-${profile.code}-${week + 1}`,
        paymentStatus === 'PARTIAL' ? 'Partial demo payment' : 'Paid in full',
        date,
        date,
      );
      receipt.run(
        transferId,
        fullLineId,
        reference,
        (week % 3) + 1,
        fullProduct.code,
        fullQuantity,
        fullProduct.cost,
        fullTotal,
        20,
        fullProduct.cost - 10,
        fullProduct.cost,
        'Demo Gas Supply',
        `INV-${profile.code}-${week + 1}`,
        date,
      );
      transferId += 1;
    }

    const disposal = db.prepare(
      'INSERT INTO disposehistory (disitemcode, disitemdesc, disqty, disremarks, disdate, disby, DisposeNote) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    disposal.run(
      'HOSE-15',
      'LPG Hose 1.5m',
      1 + (storeIndex % 2),
      'DISPOSED',
      isoDateTime(12 + storeIndex),
      'Morgan Helper',
      'Demo damaged stock',
    );

    const adjustment = db.prepare(
      `INSERT INTO inventory_adjustments
       (itemid, unit, quantity_delta, quantity_before, quantity_after, reason,
        remarks, adjusted_by, adjusted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    adjustment.run(
      1,
      'FULL',
      -1,
      24 + storeIndex,
      23 + storeIndex,
      'PHYSICAL_COUNT',
      'Demo count correction',
      'Morgan Helper',
      isoDateTime(9 + storeIndex),
    );

    const petty = db.prepare(
      `INSERT INTO pettylogstbl
       (pettylogdate, pettylogamount, pettyorigamount, pettylogby, pettylogtype,
        pettylogremarks, pettypaymenthod, pettycatid, pettyref)
       VALUES (?, ?, ?, 'Jamie Cashier', ?, ?, ?, 1, 'CONFIRMED')`,
    );
    for (let week = 0; week < 13; week += 1) {
      const daysAgo = Math.min(SNAPSHOT_DAYS - 1, week * 7 + 1);
      petty.run(
        isoDateTime(daysAgo, 16),
        money((180 + week * 12) * profile.multiplier),
        money((180 + week * 12) * profile.multiplier),
        'CASH OUT',
        ['Fuel', 'Store supplies', 'Delivery expense'][week % 3],
        'Cash',
      );
      if (week % 3 === 0) {
        petty.run(
          isoDateTime(daysAgo, 9),
          money(500 * profile.multiplier),
          money(500 * profile.multiplier),
          'CASH IN',
          'Petty cash replenishment',
          'Cash',
        );
      }
    }

    const salary = db.prepare(
      `INSERT INTO salhistory
       (salpersonel, salpersonelid, salpaid, saldate, salpaidby, salremarks,
        saltotal, salbalance, saldailypay, saladdpay, sallesspay, salincentive,
        salrefnum, salrefdate, salpaymethod)
       VALUES (?, ?, ?, ?, 'Demo Owner', ?, ?, 0, ?, 0, 0, ?, ?, ?, 'Bank Transfer')`,
    );
    for (let period = 0; period < 6; period += 1) {
      const daysAgo = Math.min(SNAPSHOT_DAYS - 1, period * 15 + 3);
      const amount = money((7500 + storeIndex * 350) * profile.multiplier);
      salary.run(
        'Jamie Cashier',
        2,
        amount,
        isoDateTime(daysAgo),
        'Demo payroll',
        amount,
        money(amount / 15),
        period % 2 ? 350 : 0,
        `${profile.code}-PAYROLL-${period + 1}`,
        isoDate(daysAgo),
      );
    }

    const feature = db.prepare(
      'INSERT INTO owner_feature_mods (feature_key, enabled, config_version, captured_at) VALUES (?, 1, 1, ?)',
    );
    for (const key of [
      'summaryCsv',
      'financialReport',
      'discountReport',
      'purchases',
      'specialReceipts',
      'customerReport',
    ]) {
      feature.run(key, isoDateTime(0));
    }
  });

  seed();
  db.pragma('optimize');
  db.close();
}

async function upsertPortalUser(prisma, clientId, account, password) {
  const existing = await prisma.portalUser.findUnique({
    where: { username: account.username },
    select: { clientId: true },
  });
  if (existing && existing.clientId !== clientId) {
    throw new Error(
      `Portal username ${account.username} belongs to another client.`,
    );
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return prisma.portalUser.upsert({
    where: { username: account.username },
    create: {
      clientId,
      username: account.username,
      displayName: account.displayName,
      passwordHash,
      role: account.role,
      status: 'ACTIVE',
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
    },
    update: {
      displayName: account.displayName,
      passwordHash,
      role: account.role,
      status: 'ACTIVE',
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const snapshotRoot = resolve(process.env.STORE_SNAPSHOT_ROOT || './data');
  const ownerPassword = configuredPassword('DEMO_OWNER_PASSWORD');
  const viewerPasswords = stores.map((_, index) =>
    configuredPassword(`DEMO_STORE_${index + 1}_PASSWORD`),
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const existingClient = await prisma.client.findUnique({
      where: { code: DEMO_CLIENT_CODE },
      select: { notes: true },
    });
    if (existingClient && !existingClient.notes?.includes(DEMO_CLIENT_MARKER)) {
      throw new Error(
        `Client code ${DEMO_CLIENT_CODE} already exists without the demo-seed marker.`,
      );
    }
    const client = await prisma.client.upsert({
      where: { code: DEMO_CLIENT_CODE },
      create: {
        code: DEMO_CLIENT_CODE,
        businessName: 'VMJAM Multi-Store Demo',
        ownerName: 'Demo Multi-Store Owner',
        email: 'demo.owner@vmjam.local',
        phone: '09170000000',
        address: 'Demo environment only',
        notes: `${DEMO_CLIENT_MARKER} Generated dashboard seed data. Safe to replace by rerunning demo:seed.`,
        status: 'ACTIVE',
      },
      update: {
        businessName: 'VMJAM Multi-Store Demo',
        ownerName: 'Demo Multi-Store Owner',
        notes: `${DEMO_CLIENT_MARKER} Generated dashboard seed data. Safe to replace by rerunning demo:seed.`,
        status: 'ACTIVE',
      },
    });

    const storeRecords = [];
    for (const definition of stores) {
      const store = await prisma.store.upsert({
        where: {
          clientId_code: { clientId: client.id, code: definition.code },
        },
        create: {
          clientId: client.id,
          code: definition.code,
          name: definition.name,
          status: 'ACTIVE',
          timezone: 'Asia/Manila',
        },
        update: {
          name: definition.name,
          status: 'ACTIVE',
          timezone: 'Asia/Manila',
        },
      });
      storeRecords.push(store);
    }

    const owner = await upsertPortalUser(
      prisma,
      client.id,
      {
        username: 'demo.owner@vmjam.local',
        displayName: 'Demo Multi-Store Owner',
        role: 'OWNER',
      },
      ownerPassword,
    );
    const viewers = [];
    for (let index = 0; index < stores.length; index += 1) {
      viewers.push(
        await upsertPortalUser(
          prisma,
          client.id,
          {
            username: stores[index].viewer,
            displayName: stores[index].viewerName,
            role: 'VIEWER',
          },
          viewerPasswords[index],
        ),
      );
    }

    await prisma.portalStoreAccess.deleteMany({
      where: {
        portalUserId: { in: [owner.id, ...viewers.map((user) => user.id)] },
      },
    });
    await prisma.portalStoreAccess.createMany({
      data: [
        ...storeRecords.map((store) => ({
          portalUserId: owner.id,
          storeId: store.id,
          roleOverride: 'OWNER',
        })),
        ...storeRecords.map((store, index) => ({
          portalUserId: viewers[index].id,
          storeId: store.id,
          roleOverride: 'VIEWER',
        })),
      ],
    });

    for (let index = 0; index < storeRecords.length; index += 1) {
      const store = storeRecords[index];
      const device = await prisma.device.upsert({
        where: { installationId: `demo-${stores[index].code.toLowerCase()}` },
        create: {
          clientId: client.id,
          storeId: store.id,
          installationId: `demo-${stores[index].code.toLowerCase()}`,
          label: `${stores[index].name} Demo POS`,
          platform: 'linux',
          appVersion: APPLICATION_VERSION,
          status: 'ACTIVE',
          lastSeenAt: new Date(),
        },
        update: {
          clientId: client.id,
          storeId: store.id,
          label: `${stores[index].name} Demo POS`,
          appVersion: APPLICATION_VERSION,
          status: 'ACTIVE',
          lastSeenAt: new Date(),
          revokedAt: null,
        },
      });

      await prisma.store.update({
        where: { id: store.id },
        data: { activeSnapshotId: null },
      });
      await prisma.storeSnapshot.deleteMany({ where: { storeId: store.id } });

      const snapshotDirectory = ensureSnapshotPath(snapshotRoot, store.id);
      rmSync(snapshotDirectory, { recursive: true, force: true });
      mkdirSync(snapshotDirectory, { recursive: true });
      const snapshotId = randomUUID();
      const fileName = `${snapshotId}.sqlite`;
      const filePath = resolve(snapshotDirectory, fileName);
      createStoreSnapshot(filePath, index);
      const sha256 = createHash('sha256')
        .update(readFileSync(filePath))
        .digest('hex');
      const fileSize = BigInt(statSync(filePath).size);
      const now = new Date();
      await prisma.storeSnapshot.create({
        data: {
          id: snapshotId,
          storeId: store.id,
          deviceId: device.id,
          schemaVersion: SCHEMA_VERSION,
          applicationVersion: APPLICATION_VERSION,
          fileName,
          fileSize,
          sha256,
          status: 'ACTIVE',
          snapshotCreatedAt: now,
          activatedAt: now,
        },
      });
      await prisma.store.update({
        where: { id: store.id },
        data: { activeSnapshotId: snapshotId },
      });
      await prisma.portalSalesTarget.upsert({
        where: {
          storeId_month: {
            storeId: store.id,
            month: isoDate(0).slice(0, 7),
          },
        },
        create: {
          storeId: store.id,
          month: isoDate(0).slice(0, 7),
          salesTarget: money(180000 * stores[index].multiplier),
          recordedGrossProfitTarget: money(52000 * stores[index].multiplier),
          updatedByPortalUserId: owner.id,
        },
        update: {
          salesTarget: money(180000 * stores[index].multiplier),
          recordedGrossProfitTarget: money(52000 * stores[index].multiplier),
          updatedByPortalUserId: owner.id,
        },
      });
      await prisma.auditLog.create({
        data: {
          action: 'sync.snapshot_activated',
          resourceType: 'store_snapshot',
          resourceId: snapshotId,
          metadata: {
            storeId: store.id,
            storeName: store.name,
            schemaVersion: SCHEMA_VERSION,
            source: 'demo_seed',
          },
        },
      });
    }

    console.log('\nDemo data is ready. Save these credentials now:\n');
    console.log(
      `OWNER (all 5 stores)\n  Username: demo.owner@vmjam.local\n  Password: ${ownerPassword}\n`,
    );
    stores.forEach((store, index) => {
      console.log(
        `${store.name.toUpperCase()} (this store only)\n  Username: ${store.viewer}\n  Password: ${viewerPasswords[index]}\n`,
      );
    });
    console.log(
      'Rerunning npm run demo:seed refreshes only DEMO-MULTI-STORE data and resets these passwords.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

const snapshotOnlyIndex = process.argv.indexOf('--snapshot-only');
if (snapshotOnlyIndex >= 0) {
  const output = process.argv[snapshotOnlyIndex + 1];
  const storeIndex = Number(process.argv[snapshotOnlyIndex + 2] ?? 0);
  if (!output || !Number.isInteger(storeIndex) || !stores[storeIndex]) {
    throw new Error(
      'Usage: node seed-demo-portal.mjs --snapshot-only <path> [store index 0-4]',
    );
  }
  createStoreSnapshot(resolve(output), storeIndex);
  console.log(`Created demo snapshot: ${resolve(output)}`);
} else {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
