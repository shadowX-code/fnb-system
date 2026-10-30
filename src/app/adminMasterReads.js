// Shared outlet scope remains eager; Restaurant datasets are not Factory dependencies.
export async function readAdminMasters(readers, { factoryOnly = false } = {}) {
  return Object.fromEntries(await Promise.all(Object.entries(readers).map(async ([key, read]) => {
    if (factoryOnly && key !== "outlets") return [key, { status: "deferred" }];
    try { return [key, { status: "fulfilled", value: await read() }]; }
    catch (reason) { return [key, { status: "rejected", reason }]; }
  })));
}
