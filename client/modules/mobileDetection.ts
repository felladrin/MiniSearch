import MobileDetect from "mobile-detect";

export const isRunningOnMobile =
  new MobileDetect(self.navigator.userAgent).mobile() !== null;
