/**
 * The mandatory testnet label (§4.1 D4) is NOT rendered here. It lives in
 * `./TestnetBanner.tsx` and is mounted by `main.tsx` as a sibling of this component —
 * outside every route and outside the error boundary — so no route, no render crash and
 * no configuration failure can produce a page without it. See that file's comment.
 */
import { EvidencePage } from "./EvidencePage.js";
import { HomePage, NotFoundPage } from "./HomePage.js";
import { useRoute } from "./router.js";

export default function App() {
  const route = useRoute();

  switch (route.kind) {
    case "home":
      return <HomePage />;
    case "reference":
      return <EvidencePage reference={route.ref} prefer={route.prefer} />;
    case "unknown":
      return <NotFoundPage path={route.path} />;
  }
}
