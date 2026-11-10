export function normalizeContactNumber(value: string): string {
    return value.replace(/\D/g, "").slice(0, 11);
}

export function isValidContactNumber(value: string): boolean {
    return /^09\d{9}$/.test(value);
}
