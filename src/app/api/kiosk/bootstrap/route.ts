import { prisma } from "@/lib/db";

export async function GET() {
  const stores = await prisma.store.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true, address: true, kiosks: { where: { active: true }, select: { code: true, name: true } } },
    orderBy: { name: "asc" },
  });
  const categories = await prisma.product.findMany({ where: { active: true }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } });
  return Response.json({ stores, categories: categories.map((item) => item.category) });
}
