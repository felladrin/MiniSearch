import MobileDetect from "mobile-detect";

export const isRunningOnMobile = (() => {
  const mobileDetect = new MobileDetect(self.navigator.userAgent);
  return mobileDetect.phone() !== null || mobileDetect.tablet() !== null;
})();
