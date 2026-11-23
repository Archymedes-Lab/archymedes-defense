import { Footer, Header } from "@/components/ui/shell";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="container-page">{children}</main>
      <Footer />
    </>
  );
}
