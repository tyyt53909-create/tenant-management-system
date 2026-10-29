export type BuildingPage = { data: { id: string; name: string }[]; meta: { totalPages: number } };
export async function fetchBuildingPage(fetcher: (page: number) => Promise<BuildingPage>, page: number): Promise<BuildingPage> {
  if (!Number.isInteger(page) || page < 1) throw new Error('invalid page');
  const result = await fetcher(page);
  if (!Array.isArray(result.data) || !Number.isInteger(result.meta?.totalPages) || result.meta.totalPages < 0) throw new Error('invalid building page');
  return result;
}
