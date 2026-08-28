/** 至少 8 位，同时包含字母和数字 */
export const PASSWORD_COMPLEXITY = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
export const PASSWORD_COMPLEXITY_MESSAGE = '密码至少 8 位，且需同时包含字母和数字';
