import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AdsCopilot from "../AdsCopilot.jsx";
const { ads } = vi.hoisted(() => ({
  ads: {
    aiCapabilities: vi.fn(),
    aiRead: vi.fn(),
    copilotPrepare: vi.fn(),
    aiUsage: vi.fn(),
    copilot: vi.fn(),
    aiReview: vi.fn(),
  },
}));
vi.mock("../adsService.js", () => ({ adsService: ads }));
const props = {
  org: "org",
  brand: "brand",
  account: "conn",
  from: "2024-09-01",
  to: "2024-09-30",
  canGenerate: true,
  canReview: true,
};
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  ads.aiCapabilities.mockResolvedValue({ ai_available: true });
  ads.aiRead.mockResolvedValue([]);
  ads.copilotPrepare.mockResolvedValue({
    brand_context_available:false,
    reporting:{reports:[{connection_id:'conn',payload:{
      account:{currency:'MYR'},date_from:props.from,date_to:props.to,
      configs:{campaigns:[{id:'campaign'}]},
      insights:{campaign:[{campaign_id:'campaign',currency:'MYR',date_start:props.from,date_stop:props.to,metrics:{spend:{value:0,state:'reported'}}}]},
    }}]},
  });
  ads.aiUsage.mockResolvedValue({ period: "last 30 days", requests: 0 });
  ads.copilot.mockResolvedValue({ state: "proposed" });
});
describe("Ads Copilot advisory workflow", () => {
  it('refreshes canonical evidence automatically after synchronization changes',async()=>{
    ads.copilotPrepare.mockResolvedValueOnce({brand_context_available:false,reporting:{reports:[]}});
    const page=render(<AdsCopilot {...props} evidenceVersion='before'/>);await screen.findByText(/No observed campaign performance/);
    page.rerender(<AdsCopilot {...props} evidenceVersion='after'/>);await vi.waitFor(()=>expect(screen.getByRole('button',{name:'Generate recommendations'}).disabled).toBe(false));
    expect(ads.copilot).not.toHaveBeenCalled();
  });
  it('does not offer generation for configuration-only evidence or another account',async()=>{
    ads.copilotPrepare.mockResolvedValue({brand_context_available:false,reporting:{reports:[{connection_id:'other',payload:{configs:{campaigns:[{id:'campaign'}]},insights:{campaign:[]}}}]}});
    render(<AdsCopilot {...props}/>);await screen.findByText(/No observed campaign performance/);
    expect(screen.getByRole('button',{name:'Generate recommendations'}).disabled).toBe(true);
    expect(screen.queryByText(/generic performance advice only/)).toBeNull();expect(ads.copilot).not.toHaveBeenCalled();
  });
  it("labels missing context and submits only a scoped advisory request", async () => {
    render(<AdsCopilot {...props} />);
    await screen.findByText(/Brand context unavailable/);
    fireEvent.click(
      screen.getByRole("button", { name: "Generate recommendations" }),
    );
    expect(ads.copilot).toHaveBeenCalledWith(
      "org",
      "brand",
      "conn",
      "2024-09-01",
      "2024-09-30",
      expect.any(String),
    );
    expect(
      screen.queryByRole("button", {
        name: /Activate|Increase budget|Create ad/,
      }),
    ).toBeNull();
  });
  it("keeps provider-unavailable generation disabled", async () => {
    ads.aiCapabilities.mockResolvedValue({ ai_available: false });
    render(<AdsCopilot {...props} />);
    await screen.findByText(/Brand context unavailable/);
    expect(
      screen.getByRole("button", { name: "Generate recommendations" }).disabled,
    ).toBe(true);
  });
  it("shows stale evidence without exposing proposal or approving it", async () => {
    ads.aiRead.mockResolvedValue([
      {
        id: "stale",
        state: "stale",
        proposal: null,
        date_from: props.from,
        date_to: props.to,
      },
    ]);
    render(<AdsCopilot {...props} />);
    await screen.findByText("stale");
    expect(screen.queryByRole("button", { name: /Mark reviewed/ })).toBeNull();
  });
});
