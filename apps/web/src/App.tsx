import { useEffect, useState } from "react";
import { usePath } from "./router.tsx";
import { CompaniesPage } from "./pages/Companies.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { SoonPage } from "./pages/Soon.tsx";
import { TeamPage } from "./pages/Team.tsx";
import { TodayPage } from "./pages/Today.tsx";
import { AtelierPage, SitesPage } from "./pages/Work.tsx";
import { Empty } from "./ui/common.tsx";
import { activeNav, CommandPalette, PageTransition, Sidebar } from "./ui/Shell.tsx";

function Route({ path }: { path: string }) {
  const section = path.split("/")[1] ?? "";
  switch (section) {
    case "":
      return <TodayPage />;
    case "entreprises":
      return <CompaniesPage />;
    case "atelier":
      return <AtelierPage />;
    case "sites":
      return <SitesPage />;
    case "prospection":
    case "commercial":
    case "finance":
      return <SoonPage id={section} />;
    case "equipe":
      return <TeamPage />;
    case "reglages":
      return <SettingsPage />;
    default:
      return (
        <div className="page">
          <Empty icon="search" title="Page introuvable">
            Cette adresse ne correspond à rien. Utilisez le menu ou Ctrl+K.
          </Empty>
        </div>
      );
  }
}

export function App() {
  const path = usePath();
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const n = activeNav(path);
    document.title = n && n.path !== "/" ? `${n.label} · Liverdian` : "Liverdian";
  }, [path]);

  return (
    <div className="app">
      <Sidebar onPalette={() => setPalette(true)} />
      <main className="main">
        <PageTransition path={path}>
          <Route path={path} />
        </PageTransition>
      </main>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
