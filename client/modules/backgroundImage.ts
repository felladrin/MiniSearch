import { getSettings, onSettingsChange } from "./pubSub";
import blackBrickImageUrl from "../images/background/dark/black-brick.jpg?url";
import blackCarbonImageUrl from "../images/background/dark/black-carbon.jpg?url";
import blackConcreteImageUrl from "../images/background/dark/black-concrete.jpg?url";
import blackDenimImageUrl from "../images/background/dark/black-denim.jpg?url";
import blackPaperImageUrl from "../images/background/dark/black-paper.jpg?url";
import blackWallImageUrl from "../images/background/dark/black-wall.jpg?url";

export const defaultBackgroundImageUrl = blackDenimImageUrl;

export const backgroundImageOptions = [
  { label: "None", value: "none" },
  {
    label: "Black Brick",
    value: blackBrickImageUrl,
  },
  {
    label: "Black Carbon",
    value: blackCarbonImageUrl,
  },
  {
    label: "Black Concrete",
    value: blackConcreteImageUrl,
  },
  {
    label: "Black Denim",
    value: blackDenimImageUrl,
  },
  {
    label: "Black Paper",
    value: blackPaperImageUrl,
  },
  {
    label: "Black Wall",
    value: blackWallImageUrl,
  },
];

function updateBackgroundImage(imageUrl: string) {
  if (imageUrl === "none") {
    document.body.style.backgroundImage = imageUrl;
  } else {
    document.body.style.backgroundImage = `url('${imageUrl}')`;
  }
}

export function initializeBackgroundImageListener() {
  const unsubscribe = onSettingsChange((settings, previousSettings) => {
    if (settings.backgroundImageUrl !== previousSettings.backgroundImageUrl) {
      updateBackgroundImage(settings.backgroundImageUrl);
    }
  });

  updateBackgroundImage(getSettings().backgroundImageUrl);

  return unsubscribe;
}
