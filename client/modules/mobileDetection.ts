import MobileDetect from "mobile-detect";

export const isRunningOnMobile = (() => {
  const { phone, tablet } = new MobileDetect(self.navigator.userAgent);
  return phone() !== null || tablet() !== null;
})();
