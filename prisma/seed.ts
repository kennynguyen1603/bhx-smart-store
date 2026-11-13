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
  ];
  const suppliers = new Map<string, { id: string }>();
  for (const item of supplierData) {
    const supplier = await prisma.supplier.upsert({ where: { code: item.code }, update: item, create: item });
    suppliers.set(item.code, supplier);
  }

  const productData = [
    { sku: "MILK-1L", barcode: "8934673574213", name: "Sữa tươi Vinamilk 100% 1L", category: "Sữa & đồ lạnh", unit: "Hộp", basePriceVnd: 32600, emoji: "🥛", supplier: "VNM" },
    { sku: "NOODLE-75", barcode: "8934563138167", name: "Mì Hảo Hảo tôm chua cay 75g", category: "Mì & thực phẩm khô", unit: "Gói", basePriceVnd: 4500, emoji: "🍜", supplier: "ACE" },
    { sku: "YOGURT-4", barcode: "8934673103222", name: "Sữa chua Vinamilk có đường lốc 4 hộp", category: "Sữa & đồ lạnh", unit: "Lốc", basePriceVnd: 31000, emoji: "🥣", supplier: "VNM" },
    { sku: "APPLE-1KG", barcode: "2900014825731", name: "Táo Gala nhập khẩu túi 1kg", category: "Rau củ & trái cây", unit: "Túi", basePriceVnd: 69900, emoji: "🍎", supplier: "FRESH" },
    { sku: "OMO-36", barcode: "8934868179070", name: "Nước giặt OMO Matic cửa trên 3.6kg", category: "Chăm sóc nhà cửa", unit: "Túi", basePriceVnd: 189000, emoji: "🧴", supplier: "UNI" },
    { sku: "BREAD-300", barcode: "8938502520167", name: "Bánh mì sandwich lúa mạch 300g", category: "Bánh & đồ ăn nhanh", unit: "Gói", basePriceVnd: 28500, emoji: "🍞", supplier: "FRESH" },
  ];
  const products = new Map<string, (typeof productData)[number] & { id: string }>();
  for (const item of productData) {
    const { supplier, ...productInput } = item;
    if (!suppliers.has(supplier)) throw new Error(`Missing supplier ${supplier}`);
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
    { name: "Thực phẩm khô", color: "#fff5bc", x: 4, y: 2, width: 2, height: 4 },
    { name: "Chăm sóc nhà", color: "#f5e7d9", x: 8, y: 2, width: 2, height: 4 },
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
      { code: "L-02", label: "Kệ sữa tươi", zone: "Sữa & đồ lạnh", x: 8, y: 1 },
      { code: "L-04", label: "Kệ sữa chua", zone: "Sữa & đồ lạnh", x: 10, y: 1 },
      { code: "C-07", label: "Kệ mì ăn liền", zone: "Thực phẩm khô", x: 4, y: 3 },
      { code: "T-03", label: "Bàn táo nhập khẩu", zone: "Rau củ & trái cây", x: 2, y: 1 },
      { code: "D-11", label: "Kệ nước giặt", zone: "Chăm sóc nhà", x: 8, y: 4 },
      { code: "A-02", label: "Kệ bánh mì", zone: "Thực phẩm khô", x: 6, y: 3 },
    ];

    for (const [index, shelfInput] of shelfData.entries()) {
      const shelf = await prisma.shelf.upsert({
        where: { storeId_code: { storeId: store.id, code: shelfInput.code } },
        update: { label: shelfInput.label, x: shelfInput.x, y: shelfInput.y, zoneId: zoneByName.get(shelfInput.zone)!.id },
        create: { storeId: store.id, zoneId: zoneByName.get(shelfInput.zone)!.id, code: shelfInput.code, label: shelfInput.label, x: shelfInput.x, y: shelfInput.y },
      });
      const productDataItem = productData[index];
      const product = products.get(productDataItem.sku)!;
      const storeOffset = store.code === "NT-Q5" ? 0 : 3;
      const stock = [3, 7, 12, 20, 8, 6][index] + storeOffset;
      const capacities = [18, 24, 16, 24, 12, 10];
      const thresholds = [4, 6, 3, 5, 3, 2];
      await prisma.inventory.upsert({
        where: { storeId_shelfId_productId: { storeId: store.id, shelfId: shelf.id, productId: product.id } },
        update: { onShelf: stock, backroom: 12 + index * 6, capacity: capacities[index], lowThreshold: thresholds[index] },
        create: { storeId: store.id, shelfId: shelf.id, productId: product.id, onShelf: stock, backroom: 12 + index * 6, capacity: capacities[index], lowThreshold: thresholds[index] },
      });
      await prisma.eSL.upsert({
        where: { code: `ESL-${store.code}-${shelfInput.code}` },
        update: { shelfId: shelf.id, productId: product.id, storeId: store.id },
        create: { code: `ESL-${store.code}-${shelfInput.code}`, storeId: store.id, shelfId: shelf.id, productId: product.id, status: EslStatus.ONLINE, ledOn: stock <= thresholds[index] },
      });

      const supplier = suppliers.get(productDataItem.supplier)!;
      await prisma.lot.upsert({
        where: { storeId_productId_batchCode: { storeId: store.id, productId: product.id, batchCode: `LOT-${store.code}-${index + 1}` } },
        update: {},
        create: {
          storeId: store.id,
          productId: product.id,
          supplierId: supplier.id,
          batchCode: `LOT-${store.code}-${index + 1}`,
          origin: productDataItem.supplier === "FRESH" ? "New Zealand" : "Việt Nam",
          receivedAt: addDays(-2),
          expiryDate: index === 2 ? addDays(2) : addDays(15 + index * 10),
          quantity: 8 + index * 4,
          status: LotStatus.AVAILABLE,
        },
      });
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

  const milk = products.get("MILK-1L")!;
  const milkInventory = await prisma.inventory.findFirstOrThrow({ where: { storeId: nguyenTrai.id, productId: milk.id }, include: { shelf: true } });
  const existingRestock = await prisma.task.findFirst({ where: { storeId: nguyenTrai.id, productId: milk.id, type: TaskType.RESTOCK, status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED] } } });
  if (!existingRestock) {
    await prisma.task.create({
      data: { storeId: nguyenTrai.id, productId: milk.id, shelfId: milkInventory.shelfId, type: TaskType.RESTOCK, status: TaskStatus.OPEN, priority: TaskPriority.HIGH, title: "Bổ sung kệ sữa tươi", note: "Tồn kệ dưới ngưỡng · LED đang nháy" },
    });
  }

  console.info("Seeded BHX Smart Store demo", {
    stores: [nguyenTrai.code, leVanViet.code],
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
