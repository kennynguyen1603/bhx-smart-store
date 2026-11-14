import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import {
  EslStatus,
  LotStatus,
  PrismaClient,
  Role,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

const addDays = (days: number) => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};

async function main() {
  if (process.env.SEED_IF_EMPTY === "true") {
    const existingUsers = await prisma.user.count();
    if (existingUsers > 0) {
      console.info("Skipped demo seed because production data already exists");
      return;
    }
  }

  const passwordHash = await hash(process.env.DEMO_PASSWORD || "Demo@123", 12);

  const [nguyenTrai, leVanViet] = await Promise.all([
    prisma.store.upsert({
      where: { code: "NT-Q5" },
      update: {},
      create: {
        code: "NT-Q5",
        name: "BHX Nguyễn Trãi",
        address: "456 Nguyễn Trãi, Phường 8, Quận 5, TP.HCM",
        mapWidth: 12,
        mapHeight: 8,
      },
    }),
    prisma.store.upsert({
      where: { code: "LVV-TD" },
      update: {},
      create: {
        code: "LVV-TD",
        name: "BHX Lê Văn Việt",
        address: "182 Lê Văn Việt, TP. Thủ Đức, TP.HCM",
        mapWidth: 12,
        mapHeight: 8,
      },
    }),
  ]);

  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: "staff@demo.bhx" },
      update: { passwordHash },
      create: { email: "staff@demo.bhx", name: "Nguyễn Hoàng An", passwordHash, role: Role.STAFF },
    }),
    prisma.user.upsert({
      where: { email: "manager@demo.bhx" },
      update: { passwordHash },
      create: { email: "manager@demo.bhx", name: "Trần Minh Quân", passwordHash, role: Role.MANAGER },
    }),
    prisma.user.upsert({
      where: { email: "admin@demo.bhx" },
      update: { passwordHash },
      create: { email: "admin@demo.bhx", name: "Lê Thanh Mai", passwordHash, role: Role.ADMIN },
    }),
  ]);

  for (const user of users) {
    const stores = user.role === Role.STAFF ? [nguyenTrai] : [nguyenTrai, leVanViet];
    for (const [index, store] of stores.entries()) {
      await prisma.userStore.upsert({
        where: { userId_storeId: { userId: user.id, storeId: store.id } },
        update: { isDefault: index === 0 },
        create: { userId: user.id, storeId: store.id, isDefault: index === 0 },
      });
    }
  }

  const supplierData = [
    { code: "VNM", name: "Công ty Cổ phần Sữa Việt Nam", country: "Việt Nam", certificate: "ISO 22000" },
    { code: "ACE", name: "Acecook Việt Nam", country: "Việt Nam", certificate: "HACCP" },
    { code: "FRESH", name: "Fresh Farm Cooperative", country: "New Zealand", certificate: "GlobalG.A.P." },
    { code: "UNI", name: "Unilever Việt Nam", country: "Việt Nam", certificate: "ISO 9001" },
    { code: "DALA", name: "Nông trại Đà Lạt GAP", country: "Việt Nam", certificate: "VietGAP" },
    { code: "TFRUIT", name: "Thành Công Fruit", country: "Việt Nam", certificate: "GlobalG.A.P." },
    { code: "CPV", name: "C.P. Việt Nam", country: "Việt Nam", certificate: "ISO 22000" },
    { code: "BEL", name: "Bel Việt Nam", country: "Pháp", certificate: "FSSC 22000" },
    { code: "LOC", name: "Tập đoàn Lộc Trời", country: "Việt Nam", certificate: "HACCP" },
    { code: "MSN", name: "Masan Consumer", country: "Việt Nam", certificate: "ISO 22000" },
    { code: "SGP", name: "Giấy Sài Gòn", country: "Việt Nam", certificate: "FSC" },
    { code: "KDO", name: "KIDO Foods", country: "Việt Nam", certificate: "HACCP" },
  ];
  const suppliers = new Map<string, { id: string }>();
  for (const item of supplierData) {
    const supplier = await prisma.supplier.upsert({ where: { code: item.code }, update: item, create: item });
    suppliers.set(item.code, supplier);
  }

  const productData = [
    { sku: "MILK-1L", barcode: "8934673574213", name: "Sữa tươi Vinamilk 100% 1L", category: "Sữa & đồ lạnh", unit: "Hộp", basePriceVnd: 32600, emoji: "🥛", supplier: "VNM", origin: "Việt Nam" },
    { sku: "NOODLE-75", barcode: "8934563138167", name: "Mì Hảo Hảo tôm chua cay 75g", category: "Mì & thực phẩm khô", unit: "Gói", basePriceVnd: 4500, emoji: "🍜", supplier: "ACE", origin: "Việt Nam" },
    { sku: "YOGURT-4", barcode: "8934673103222", name: "Sữa chua Vinamilk có đường lốc 4 hộp", category: "Sữa & đồ lạnh", unit: "Lốc", basePriceVnd: 31000, emoji: "🥣", supplier: "VNM", origin: "Việt Nam" },
    { sku: "APPLE-1KG", barcode: "2900014825731", name: "Táo Gala nhập khẩu túi 1kg", category: "Rau củ & trái cây", unit: "Túi", basePriceVnd: 69900, emoji: "🍎", supplier: "FRESH", origin: "New Zealand" },
    { sku: "OMO-36", barcode: "8934868179070", name: "Nước giặt OMO Matic cửa trên 3.6kg", category: "Chăm sóc nhà cửa", unit: "Túi", basePriceVnd: 189000, emoji: "🧴", supplier: "UNI", origin: "Việt Nam" },
    { sku: "BREAD-300", barcode: "8938502520167", name: "Bánh mì sandwich lúa mạch 300g", category: "Bánh & đồ ăn nhanh", unit: "Gói", basePriceVnd: 28500, emoji: "🍞", supplier: "KDO", origin: "Việt Nam" },
    { sku: "GREENS-500", barcode: "2900012345678", name: "Cải xanh VietGAP gói 500g", category: "Rau củ & trái cây", unit: "Gói", basePriceVnd: 17900, emoji: "🥬", supplier: "DALA", origin: "Đà Lạt, Việt Nam" },
    { sku: "ORANGE-1KG", barcode: "2900019876543", name: "Cam Navel Úc túi 1kg", category: "Rau củ & trái cây", unit: "Túi", basePriceVnd: 79900, emoji: "🍊", supplier: "TFRUIT", origin: "Úc" },
    { sku: "EGGS-10", barcode: "8935054700017", name: "Trứng gà tươi C.P hộp 10 quả", category: "Trứng & thực phẩm mát", unit: "Hộp", basePriceVnd: 34500, emoji: "🥚", supplier: "CPV", origin: "Việt Nam" },
    { sku: "CHEESE-8", barcode: "3073781164990", name: "Phô mai Con Bò Cười hộp 8 miếng", category: "Sữa & đồ lạnh", unit: "Hộp", basePriceVnd: 53500, emoji: "🧀", supplier: "BEL", origin: "Pháp" },
    { sku: "RICE-ST25", barcode: "8936036024052", name: "Gạo thơm ST25 túi 5kg", category: "Mì & thực phẩm khô", unit: "Túi", basePriceVnd: 179000, emoji: "🍚", supplier: "LOC", origin: "Sóc Trăng, Việt Nam" },
    { sku: "FISHSAUCE-750", barcode: "8936136160050", name: "Nước mắm Nam Ngư 750ml", category: "Gia vị & nước chấm", unit: "Chai", basePriceVnd: 52900, emoji: "🫙", supplier: "MSN", origin: "Việt Nam" },
    { sku: "DISH-750", barcode: "8934868106878", name: "Nước rửa chén Sunlight lô hội 750g", category: "Chăm sóc nhà cửa", unit: "Chai", basePriceVnd: 32900, emoji: "🧽", supplier: "UNI", origin: "Việt Nam" },
    { sku: "TISSUE-10", barcode: "8935001700237", name: "Giấy vệ sinh Bless You 10 cuộn", category: "Chăm sóc nhà cửa", unit: "Lốc", basePriceVnd: 74900, emoji: "🧻", supplier: "SGP", origin: "Việt Nam" },
  ];
  const products = new Map<string, (typeof productData)[number] & { id: string }>();
  for (const item of productData) {
    const productInput = { sku: item.sku, barcode: item.barcode, name: item.name, category: item.category, unit: item.unit, basePriceVnd: item.basePriceVnd, emoji: item.emoji };
    if (!suppliers.has(item.supplier)) throw new Error(`Missing supplier ${item.supplier}`);
    const product = await prisma.product.upsert({
      where: { sku: item.sku },
      update: { ...productInput, searchText: normalize(`${item.name} ${item.category} ${item.barcode} ${item.sku}`) },
      create: { ...productInput, searchText: normalize(`${item.name} ${item.category} ${item.barcode} ${item.sku}`) },
    });
    products.set(item.sku, { ...item, id: product.id });
  }

  const layouts = [
    { name: "Rau củ & trái cây", color: "#dff3e7", x: 0, y: 0, width: 5, height: 1 },
    { name: "Sữa & đồ lạnh", color: "#dcecf8", x: 7, y: 0, width: 5, height: 1 },
    { name: "Thực phẩm khô", color: "#fff5bc", x: 4, y: 3, width: 2, height: 3 },
    { name: "Bánh & đồ ăn nhanh", color: "#f9ead7", x: 6, y: 3, width: 1, height: 3 },
    { name: "Chăm sóc nhà", color: "#f5e7d9", x: 8, y: 3, width: 2, height: 3 },
  ];

  for (const store of [nguyenTrai, leVanViet]) {
    const zoneByName = new Map<string, { id: string }>();
    for (const zone of layouts) {
      const saved = await prisma.zone.upsert({
        where: { storeId_name: { storeId: store.id, name: zone.name } },
        update: zone,
        create: { storeId: store.id, ...zone },
      });
      zoneByName.set(zone.name, saved);
    }

    const shelfData = [
      { code: "T-01", label: "Kệ rau VietGAP", zone: "Rau củ & trái cây", sku: "GREENS-500", x: 0, y: 1, stockNguyenTrai: 10, stockLeVanViet: 0, backroom: 20, capacity: 18, threshold: 4, lotQuantity: 10, expiryDays: 3, secondaryQuantity: 12, secondaryExpiryDays: 6 },
      { code: "T-03", label: "Bàn táo nhập khẩu", zone: "Rau củ & trái cây", sku: "APPLE-1KG", x: 2, y: 1, stockNguyenTrai: 20, stockLeVanViet: 4, backroom: 30, capacity: 24, threshold: 5, lotQuantity: 12, expiryDays: 7, secondaryQuantity: 18, secondaryExpiryDays: 18 },
      { code: "T-05", label: "Bàn cam nhập khẩu", zone: "Rau củ & trái cây", sku: "ORANGE-1KG", x: 4, y: 1, stockNguyenTrai: 3, stockLeVanViet: 12, backroom: 22, capacity: 20, threshold: 4, lotQuantity: 10, expiryDays: 10, secondaryQuantity: 14, secondaryExpiryDays: 20 },
      { code: "L-01", label: "Kệ trứng tươi", zone: "Sữa & đồ lạnh", sku: "EGGS-10", x: 7, y: 1, stockNguyenTrai: 2, stockLeVanViet: 8, backroom: 30, capacity: 15, threshold: 3, lotQuantity: 20, expiryDays: 1, secondaryQuantity: 24, secondaryExpiryDays: 8 },
      { code: "L-02", label: "Kệ sữa tươi", zone: "Sữa & đồ lạnh", sku: "MILK-1L", x: 8, y: 1, stockNguyenTrai: 3, stockLeVanViet: 9, backroom: 12, capacity: 18, threshold: 4, lotQuantity: 8, expiryDays: 8, secondaryQuantity: 12, secondaryExpiryDays: 18 },
      { code: "L-04", label: "Kệ sữa chua", zone: "Sữa & đồ lạnh", sku: "YOGURT-4", x: 10, y: 1, stockNguyenTrai: 12, stockLeVanViet: 2, backroom: 24, capacity: 16, threshold: 3, lotQuantity: 10, expiryDays: 2, secondaryQuantity: 14, secondaryExpiryDays: 12 },
      { code: "L-06", label: "Kệ phô mai", zone: "Sữa & đồ lạnh", sku: "CHEESE-8", x: 11, y: 1, stockNguyenTrai: 0, stockLeVanViet: 5, backroom: 10, capacity: 12, threshold: 2, lotQuantity: 3, expiryDays: -1, secondaryQuantity: 10, secondaryExpiryDays: 20 },
      { code: "C-03", label: "Kệ gia vị & nước chấm", zone: "Thực phẩm khô", sku: "FISHSAUCE-750", x: 4, y: 3, stockNguyenTrai: 4, stockLeVanViet: 10, backroom: 20, capacity: 15, threshold: 4, lotQuantity: 16, expiryDays: 300, secondaryQuantity: null, secondaryExpiryDays: null },
      { code: "C-07", label: "Kệ mì ăn liền", zone: "Thực phẩm khô", sku: "NOODLE-75", x: 4, y: 4, stockNguyenTrai: 7, stockLeVanViet: 0, backroom: 18, capacity: 24, threshold: 6, lotQuantity: 12, expiryDays: 180, secondaryQuantity: null, secondaryExpiryDays: null },
      { code: "C-09", label: "Kệ gạo đóng túi", zone: "Thực phẩm khô", sku: "RICE-ST25", x: 4, y: 5, stockNguyenTrai: 15, stockLeVanViet: 3, backroom: 25, capacity: 20, threshold: 4, lotQuantity: 20, expiryDays: 365, secondaryQuantity: null, secondaryExpiryDays: null },
      { code: "A-02", label: "Kệ bánh mì", zone: "Bánh & đồ ăn nhanh", sku: "BREAD-300", x: 6, y: 4, stockNguyenTrai: 6, stockLeVanViet: 1, backroom: 42, capacity: 10, threshold: 2, lotQuantity: 14, expiryDays: 4, secondaryQuantity: 18, secondaryExpiryDays: 7 },
      { code: "D-03", label: "Kệ nước rửa chén", zone: "Chăm sóc nhà", sku: "DISH-750", x: 9, y: 3, stockNguyenTrai: 1, stockLeVanViet: 0, backroom: 14, capacity: 10, threshold: 3, lotQuantity: 12, expiryDays: 600, secondaryQuantity: null, secondaryExpiryDays: null },
      { code: "D-11", label: "Kệ nước giặt", zone: "Chăm sóc nhà", sku: "OMO-36", x: 9, y: 4, stockNguyenTrai: 8, stockLeVanViet: 5, backroom: 36, capacity: 12, threshold: 3, lotQuantity: 24, expiryDays: 540, secondaryQuantity: null, secondaryExpiryDays: null },
      { code: "D-13", label: "Kệ giấy gia dụng", zone: "Chăm sóc nhà", sku: "TISSUE-10", x: 9, y: 5, stockNguyenTrai: 9, stockLeVanViet: 2, backroom: 20, capacity: 12, threshold: 3, lotQuantity: 18, expiryDays: 700, secondaryQuantity: null, secondaryExpiryDays: null },
    ];

    for (const [index, shelfInput] of shelfData.entries()) {
      const shelf = await prisma.shelf.upsert({
        where: { storeId_code: { storeId: store.id, code: shelfInput.code } },
        update: { label: shelfInput.label, x: shelfInput.x, y: shelfInput.y, zoneId: zoneByName.get(shelfInput.zone)!.id },
        create: { storeId: store.id, zoneId: zoneByName.get(shelfInput.zone)!.id, code: shelfInput.code, label: shelfInput.label, x: shelfInput.x, y: shelfInput.y },
      });
      const productDataItem = productData.find((item) => item.sku === shelfInput.sku)!;
      const product = products.get(productDataItem.sku)!;
      const stock = store.code === "NT-Q5" ? shelfInput.stockNguyenTrai : shelfInput.stockLeVanViet;
      await prisma.inventory.deleteMany({ where: { storeId: store.id, shelfId: shelf.id, productId: { not: product.id } } });
      await prisma.inventory.upsert({
        where: { storeId_shelfId_productId: { storeId: store.id, shelfId: shelf.id, productId: product.id } },
        update: { onShelf: stock, backroom: shelfInput.backroom, capacity: shelfInput.capacity, lowThreshold: shelfInput.threshold },
        create: { storeId: store.id, shelfId: shelf.id, productId: product.id, onShelf: stock, backroom: shelfInput.backroom, capacity: shelfInput.capacity, lowThreshold: shelfInput.threshold },
      });
      await prisma.eSL.upsert({
        where: { code: `ESL-${store.code}-${shelfInput.code}` },
        update: { shelfId: shelf.id, productId: product.id, storeId: store.id, status: EslStatus.ONLINE, ledOn: stock <= shelfInput.threshold },
        create: { code: `ESL-${store.code}-${shelfInput.code}`, storeId: store.id, shelfId: shelf.id, productId: product.id, status: EslStatus.ONLINE, ledOn: stock <= shelfInput.threshold },
      });

      const supplier = suppliers.get(productDataItem.supplier)!;
      const lotSeeds = [
        { batchCode: `LOT-${store.code}-${index + 1}`, quantity: shelfInput.lotQuantity, expiryDays: shelfInput.expiryDays, receivedDays: -2 },
        ...(shelfInput.secondaryQuantity !== null && shelfInput.secondaryExpiryDays !== null
          ? [{ batchCode: `LOT-${store.code}-${index + 1}-B`, quantity: shelfInput.secondaryQuantity, expiryDays: shelfInput.secondaryExpiryDays, receivedDays: -1 }]
          : []),
      ];
      for (const lotInput of lotSeeds) {
        await prisma.lot.deleteMany({ where: { storeId: store.id, batchCode: lotInput.batchCode, productId: { not: product.id } } });
        await prisma.lot.upsert({
          where: { storeId_productId_batchCode: { storeId: store.id, productId: product.id, batchCode: lotInput.batchCode } },
          update: {
            supplierId: supplier.id,
            origin: productDataItem.origin,
            receivedAt: addDays(lotInput.receivedDays),
            expiryDate: addDays(lotInput.expiryDays),
            quantity: lotInput.quantity,
            status: LotStatus.AVAILABLE,
            markdownPercent: null,
            markdownPriceVnd: null,
          },
          create: {
            storeId: store.id,
            productId: product.id,
            supplierId: supplier.id,
            batchCode: lotInput.batchCode,
            origin: productDataItem.origin,
            receivedAt: addDays(lotInput.receivedDays),
            expiryDate: addDays(lotInput.expiryDays),
            quantity: lotInput.quantity,
            status: LotStatus.AVAILABLE,
          },
        });
      }
    }

    await prisma.kioskDevice.upsert({
      where: { code: `KIOSK-${store.code}-01` },
      update: {},
      create: { storeId: store.id, code: `KIOSK-${store.code}-01`, name: "Kiosk lối vào", x: 0, y: 7 },
    });

    for (const rule of [
      { daysRemaining: 3, discountPercent: 20, quarantine: false },
      { daysRemaining: 1, discountPercent: 30, quarantine: false },
      { daysRemaining: 0, discountPercent: 100, quarantine: true },
    ]) {
      await prisma.fefoRule.upsert({
        where: { storeId_daysRemaining: { storeId: store.id, daysRemaining: rule.daysRemaining } },
        update: rule,
        create: { storeId: store.id, ...rule },
      });
    }
  }

  await prisma.notification.deleteMany({ where: { storeId: { in: [nguyenTrai.id, leVanViet.id] } } });
  await prisma.task.deleteMany({ where: { storeId: { in: [nguyenTrai.id, leVanViet.id] } } });

  const taskSeeds = [
    { sku: "MILK-1L", type: TaskType.RESTOCK, priority: TaskPriority.HIGH, title: "Bổ sung kệ sữa tươi", note: "Tồn kệ dưới ngưỡng · LED đang nháy", withLot: false },
    { sku: "ORANGE-1KG", type: TaskType.RESTOCK, priority: TaskPriority.MEDIUM, title: "Bổ sung bàn cam nhập khẩu", note: "Tồn kệ chạm ngưỡng cảnh báo", withLot: false },
    { sku: "DISH-750", type: TaskType.RESTOCK, priority: TaskPriority.HIGH, title: "Bổ sung nước rửa chén", note: "Kệ chỉ còn 1 sản phẩm · ưu tiên xử lý", withLot: false },
    { sku: "YOGURT-4", type: TaskType.FEFO, priority: TaskPriority.MEDIUM, title: "Dán nhãn FEFO sữa chua", note: "Lô gần nhất còn 2 ngày · giảm 20%", withLot: true },
    { sku: "EGGS-10", type: TaskType.FEFO, priority: TaskPriority.HIGH, title: "Dán nhãn FEFO trứng gà", note: "Lô gần nhất còn 1 ngày · giảm 30%", withLot: true },
    { sku: "CHEESE-8", type: TaskType.QUARANTINE, priority: TaskPriority.HIGH, title: "Cách ly lô phô mai hết hạn", note: "Không được bày bán · chuyển khỏi khu vực bán", withLot: true },
  ];
  for (const taskInput of taskSeeds) {
    const product = products.get(taskInput.sku)!;
    const inventory = await prisma.inventory.findFirstOrThrow({ where: { storeId: nguyenTrai.id, productId: product.id } });
    const lot = taskInput.withLot
      ? await prisma.lot.findFirstOrThrow({ where: { storeId: nguyenTrai.id, productId: product.id }, orderBy: { expiryDate: "asc" } })
      : null;
    const existing = await prisma.task.findFirst({
      where: {
        storeId: nguyenTrai.id,
        productId: product.id,
        type: taskInput.type,
        ...(lot ? { lotId: lot.id } : {}),
        status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED] },
      },
    });
    if (!existing) {
      await prisma.task.create({
        data: {
          storeId: nguyenTrai.id,
          productId: product.id,
          shelfId: inventory.shelfId,
          lotId: lot?.id,
          type: taskInput.type,
          status: TaskStatus.OPEN,
          priority: taskInput.priority,
          title: taskInput.title,
          note: taskInput.note,
          dueAt: addDays(0),
        },
      });
    }
    await prisma.eSL.updateMany({ where: { storeId: nguyenTrai.id, shelfId: inventory.shelfId, productId: product.id }, data: { ledOn: true } });
  }

  console.info("Seeded BHX Smart Store demo", {
    stores: [nguyenTrai.code, leVanViet.code],
    products: products.size,
    suppliers: suppliers.size,
    taskTypes: [TaskType.RESTOCK, TaskType.FEFO, TaskType.QUARANTINE],
    users: users.map((user) => user.email),
    password: process.env.DEMO_PASSWORD || "Demo@123",
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
