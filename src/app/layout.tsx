import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "@/styles/globals.css";
import { AppShell } from "@/components/app-shell";
import { StoreHydrator } from "@/components/store-hydrator";
import { ThemeProvider } from "@/components/theme-provider";
import { PreferencesHydrator } from "@/components/ui/figures";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "ws-analytics",
	description:
		"Upload a CSV, explore it as charts and tables, and export a PDF report — entirely in your browser.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html
			className={cn(
				"h-full",
				"antialiased",
				inter.variable,
				geistMono.variable,
				"font-sans",
			)}
			lang="en"
			suppressHydrationWarning
		>
			<body className="flex min-h-full flex-col">
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					disableTransitionOnChange
					enableSystem
				>
					<StoreHydrator />
					<PreferencesHydrator />
					{/* Base UI groups tooltip delays per provider, so it lives once at
					the root rather than around each consumer. */}
					<TooltipProvider>
						<AppShell>{children}</AppShell>
					</TooltipProvider>
					<Toaster />
				</ThemeProvider>
			</body>
		</html>
	);
}
