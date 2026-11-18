// Coordinates are in metres. Each cabin faces the cutaway on its positive Z side.
export const rooms = [
  { id: "command", name: "Command Hub", code: "C0", at: [.45, -.10, 5.60], hullScale: [1.48, 1.08, 1.24], accent: "#55d8df", subject: "Orbital projector", detail: "A rotating globe at the centre of the station’s navigation table.", role: "Flight director", activity: "Coordinates the simulated flight deck." },
  { id: "finance", name: "Finance Hub", code: "F1", at: [-1.05, 2.02, -6.60], hullScale: [1, 1, 1], accent: "#67d7c5", subject: "Analysis terminal", detail: "The analyst’s desk links to the Finance overview.", role: "Financial analyst", activity: "Reviews illustrative charts at the analysis desk.", route: "finance_overview", link: "Open Finance overview" },
  { id: "factory", name: "Factory Lab", code: "F2", at: [-9.1, .3, -.35], hullScale: [1, 1, 1], accent: "#ffac58", subject: "Inspection arm", detail: "An articulated inspection rig beside the production console.", role: "Production technician", activity: "Inspects the equipment on a simulated production round.", route: "factory_job_orders", link: "Open Production Overview" },
  { id: "marketing", name: "Marketing Studio", code: "M3", at: [8.7, 1.15, -2.2], hullScale: [1.07, 1, 1], accent: "#bd98fa", subject: "Studio camera", detail: "A small set for framing content and reviewing creative work.", role: "Content producer", activity: "Frames a shot and reviews the studio storyboard.", route: "marketing_calendar", link: "Open Content Management" },
];

export const roomById = Object.fromEntries(rooms.map(room => [room.id, room]));

export function objectsIn(room) {
  const consoleName = room.id === "command" ? "Navigation display" : room.id === "finance" ? "Market display" : room.id === "factory" ? "Production console" : "Editing monitor";
  return [
    { id: "equipment", label: room.subject, detail: room.detail, module: room.id !== "command" },
    { id: "screen", label: consoleName, detail: "An animated training display in the simulated workspace.", module: room.id !== "command" },
    { id: "specialist", label: room.role, detail: room.activity, character: true },
    { id: "operator", label: room.id === "marketing" ? "Video editor" : "Console operator", detail: "Works at the cabin console during this local simulation.", character: true },
    { id: "visitor", label: "Station liaison", detail: "Walks the aisle and stops for brief conversations.", character: true },
  ];
}
