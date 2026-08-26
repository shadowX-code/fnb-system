// Guest AI consumes FeedX business data only through future explicit contracts.
export function createGuestAiBusinessContextService({ outletDirectory, menuCatalog } = {}) { return Object.freeze({ outletDirectory, menuCatalog }); }
