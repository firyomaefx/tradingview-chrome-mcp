export const metadata = {
  title: "TradingView MCP Hosted",
  description: "Vercel-hosted SSE MCP server for market data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
