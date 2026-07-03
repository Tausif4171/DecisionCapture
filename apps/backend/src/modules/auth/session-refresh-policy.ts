export function shouldUseSingleFlightRefresh(activeRefreshes: number) {
    return activeRefreshes > 0;
}

export function describeSingleFlightRefreshPolicy() {
    return "Use one in-flight refresh request at a time so concurrent token refreshes do not race and invalidate the active session.";
}