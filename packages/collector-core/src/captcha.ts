const BLOCK_PATTERNS = [
  /captcha/i,
  /recaptcha/i,
  /cloudflare/i,
  /access denied/i,
  /доступ ограничен/i,
  /подтвердите.?что.?вы.?не.?робот/i,
  /are you a robot/i,
  /cf-challenge/i,
];

/** 已渲染商品页会内嵌 captcha SDK，不能仅凭 HTML 里出现 captcha 字样就拦截 */
const PRODUCT_SIGNALS = [
  /"@type"\s*:\s*"Product"/i,
  /data-widget="webProductHeading"/i,
  /data-widget="webPrice"/i,
  /data-widget="webSale"/i,
];

export function detectCaptchaOrBlock(htmlOrText: string): boolean {
  if (!htmlOrText) {
    return false;
  }
  if (PRODUCT_SIGNALS.some((pattern) => pattern.test(htmlOrText))) {
    return false;
  }
  return BLOCK_PATTERNS.some((pattern) => pattern.test(htmlOrText));
}
