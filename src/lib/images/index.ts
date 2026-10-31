// Photos of the Southport Fire Department at past Christmas parades.
// Static imports give next/image the dimensions and a blur placeholder.
import headquarters from "../../../public/images/tower-361-engine-5-headquarters.jpg";
import ladderRides from "../../../public/images/tower-361-ladder-rides.jpg";
import families from "../../../public/images/fire-headquarters-families.jpg";
import staging from "../../../public/images/staging-fire-apparatus.jpg";
import towerFamilies from "../../../public/images/tower-361-families.jpg";

export const photos = {
  headquarters: { src: headquarters, alt: "Southport Tower 361 and Engine 5 lit up for Christmas outside Southport Fire Headquarters" },
  ladderRides: { src: ladderRides, alt: "Families climbing onto Southport Tower 361 at night" },
  families: { src: families, alt: "Southport firefighters in dress uniform greeting families at Fire Headquarters" },
  staging: { src: staging, alt: "Fire apparatus lined up on a closed street with firefighters standing by" },
  towerFamilies: { src: towerFamilies, alt: "Children and parents gathered behind Southport Tower 361 with a lit Christmas tree" },
};
