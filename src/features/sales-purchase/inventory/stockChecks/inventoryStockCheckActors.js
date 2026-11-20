import { readCompleteInventoryRows } from "../../../../services/inventoryCompleteRead.js";
import { uniqueIds } from "../inventoryItemModel.js";
import { employeeDisplayName } from "../waste/inventoryWasteService.js";

const unknown = "Unknown User";
const actorColumns = "id, auth_user_id, full_name, nickname, email";

async function readActorsBy(column, ids) {
  const unique = uniqueIds(ids);
  const pages = await Promise.all(Array.from({ length: Math.ceil(unique.length / 100) }, (_, index) =>
    readCompleteInventoryRows("employees", { select: actorColumns, in: { [column]: unique.slice(index * 100, index * 100 + 100) } })));
  return pages.flatMap(page => page.data);
}

// Callers pass identities from already scoped Stock Check headers.
export async function readStockCheckActors(employeeIds, authIds) {
  const [employees, authEmployees] = await Promise.all([
    readActorsBy("id", employeeIds),
    readActorsBy("auth_user_id", authIds),
  ]);
  return [...new Map([...employees, ...authEmployees].map(employee => [employee.id, employee])).values()]
    .map(employee => ({ id: employee.id, authUserId: employee.auth_user_id, name: employeeDisplayName(employee) }));
}

export function indexStockCheckActors(people) {
  return {
    byEmployeeId: new Map(people.filter(person => person.id).map(person => [person.id, person.name])),
    byAuthId: new Map(people.filter(person => person.authUserId).map(person => [person.authUserId, person.name])),
  };
}

export function stockCheckActorNames(check, actors) {
  const creator = check.createdByEmployeeId
    ? actors.byEmployeeId.get(check.createdByEmployeeId)
    : actors.byAuthId.get(check.createdBy);
  return {
    createdByName: creator || unknown,
    submittedByName: actors.byEmployeeId.get(check.submittedBy) || unknown,
  };
}
