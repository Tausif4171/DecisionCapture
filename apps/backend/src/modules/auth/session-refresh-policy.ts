export function shouldUseSingleFlightRefresh(activeRefreshes: number) {
    return activeRefreshes > 0;
}