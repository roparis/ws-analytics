// `html2canvas-pro` rather than `html2canvas`: the original's colour parser
// predates the CSS Color 4 functions and throws on the first one it meets
// ("unsupported color function"). Our theme tokens in `globals.css` are all
// `oklch()`, which Chrome hands back to the parser as `lab()`, so every export
// failed before it drew a pixel. The fork is API-compatible and understands
// `lab`/`lch`/`oklab`/`oklch`.
import html2canvas from "html2canvas-pro";
import { jsPDF } from "jspdf";

export async function exportElementToPdf(
	element: HTMLElement,
	filename: string,
) {
	const canvas = await html2canvas(element, {
		scale: 2,
		backgroundColor:
			getComputedStyle(document.body).backgroundColor || "#ffffff",
	});

	const imgData = canvas.toDataURL("image/png");
	const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

	const pageWidth = pdf.internal.pageSize.getWidth();
	const pageHeight = pdf.internal.pageSize.getHeight();
	const imgWidth = pageWidth;
	const imgHeight = (canvas.height * imgWidth) / canvas.width;

	let heightLeft = imgHeight;
	let position = 0;

	pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
	heightLeft -= pageHeight;

	while (heightLeft > 0) {
		position = heightLeft - imgHeight;
		pdf.addPage();
		pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
		heightLeft -= pageHeight;
	}

	pdf.save(filename);
}
