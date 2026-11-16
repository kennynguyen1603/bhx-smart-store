import { overview, store, product, supplier } from "./admin-core";
export const zone = { id: "zone-second", name: "Khu thứ hai", color: "#abcdef", x: 2, y: 3, width: 4, height: 2 };
export const secondProduct = { ...product, id: "product-second", sku: "SKU-SECOND", name: "Sản phẩm thứ hai" };
export const secondSupplier = { ...supplier, id: "supplier-second", code: "SUP-SECOND", name: "Nhà cung cấp thứ hai" };
export const shelf = { id: "shelf-second", storeId: store.id, zoneId: zone.id, code: "K-02", label: "Kệ thứ hai", x: 3, y: 2, width: 2, height: 3, zone, esls: [
  { id: "esl-first", code: "ESL-ONE", storeId: store.id, shelfId: "shelf-second", productId: product.id, ledOn: false, product },
  { id: "esl-second", code: "ESL-TWO", storeId: store.id, shelfId: "shelf-second", productId: secondProduct.id, ledOn: true, product: secondProduct },
] };
export const referenceStore = { ...store, zones: [{ ...zone, id: "zone-first", name: "Khu đầu" }, zone], shelves: [{ ...shelf, id: "shelf-first", code: "K-01", esls: [] }, shelf] };
export const otherStore = { ...store, id: "store-other", code: "BHX-OTHER", name: "Cửa hàng mặc định khác" };
export const account = { id: "account-second", name: "Người dùng hai", email: "hai@example.com", role: "MANAGER", active: false, userStores: [
  { storeId: store.id, isDefault: false, store: { id: store.id, name: store.name } },
  { storeId: otherStore.id, isDefault: true, store: { id: otherStore.id, name: otherStore.name } },
] };
export const lot = { id: "lot-second", storeId: store.id, productId: secondProduct.id, supplierId: secondSupplier.id, batchCode: "LOT-TWO", origin: "Đà Lạt", receivedAt: "2026-11-10T05:00:00Z", expiryDate: "2026-12-25T00:00:00Z", quantity: 17, status: "AVAILABLE", markdownPercent: null, product: secondProduct, supplier: secondSupplier, store };
export const rule = { id: "rule-second", storeId: store.id, daysRemaining: 5, discountPercent: 35, quarantine: true, active: false };
export const referenceOverview = { ...overview, stores: [referenceStore, otherStore], products: [product, secondProduct], suppliers: [supplier, secondSupplier], users: [account], lots: [lot], rules: [rule] };
