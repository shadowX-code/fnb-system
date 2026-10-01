import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useCrewTaskTitles from "../useCrewTaskTitles.js";
import { crewService } from "../../../../services/crewService.js";
const locale = vi.hoisted(() => ({ language: "zh-CN" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: locale }) }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { localizedContentForCrew: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); locale.language="zh-CN"; });
describe("Crew Task list title localization", () => {
  it("refreshes existing title units on locale changes with authored fallback", async () => {
    crewService.localizedContentForCrew.mockImplementation(async (_token, _domain, _ids, language) => ({ version: { "task.name": language === "zh-CN" ? "打烊工作" : "Tugas Penutupan" } }));
    const tasks=[{id:"one", template_id:"version", name:"Closing Duties"},{id:"legacy",name:"Authored name"}];
    const view=renderHook(() => useCrewTaskTitles("token", tasks));
    await waitFor(() => expect(view.result.current[0].name).toBe("打烊工作"));
    expect(view.result.current[1].name).toBe("Authored name");
    locale.language="ms"; view.rerender();
    expect(view.result.current[0].name).toBe("Closing Duties");
    await waitFor(() => expect(view.result.current[0].name).toBe("Tugas Penutupan"));
  });
  it("never applies a stale employee request after session replacement", async () => {
    let resolve;
    crewService.localizedContentForCrew.mockImplementationOnce(() => new Promise(done => {resolve=done;})).mockResolvedValue({version:{"task.name":"New employee title"}});
    const tasks=[{template_id:"version",name:"Source"}];
    const view=renderHook(({token}) => useCrewTaskTitles(token,tasks),{initialProps:{token:"old"}});
    view.rerender({token:"new"});
    await waitFor(() => expect(view.result.current[0].name).toBe("New employee title"));
    resolve({version:{"task.name":"Old employee title"}});
    await waitFor(() => expect(view.result.current[0].name).toBe("New employee title"));
  });
});
