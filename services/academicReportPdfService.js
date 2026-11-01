function pdfText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/([\\()])/g, "\\$1");
}

function score(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

function wrapText(value, width = 88) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else { lines.push(current); current = word; }
    while (current.length > width) { lines.push(current.slice(0, width)); current = current.slice(width); }
  }
  if (current) lines.push(current);
  return lines;
}

function pushWrapped(lines, text, options = {}) {
  const width = options.size && options.size <= 9 ? 98 : 88;
  wrapText(text, width).forEach((part, index) => lines.push({ ...options, text: part, gap: index ? 13 : options.gap }));
}

function reportLines(snapshot) {
  const identity = snapshot.institution || {};
  const student = snapshot.student || {};
  const period = snapshot.period || {};
  const ranking = snapshot.ranking || {};
  const attendance = snapshot.attendance || {};
  const lines = [
    { text: identity.name || snapshot.unit_name || "Lembaga Pendidikan", bold: true, size: 16 },
    { text: "LAPORAN HASIL BELAJAR SEMESTER", bold: true, size: 13, gap: 8 },
    { text: `Nama: ${student.name || "-"}` },
    { text: `NIS: ${student.nis || "-"}` },
    { text: `Kelas: ${snapshot.class_name || "-"}` },
    { text: `Tahun Ajaran: ${period.academic_year || "-"} | Semester: ${period.semester || "-"}`, gap: 8 },
    { text: "MATA PELAJARAN", bold: true },
  ];
  if (identity.address) lines.splice(1, 0, ...wrapText(identity.address, 98).map((text) => ({ text, size: 9, gap: 13 })));
  (snapshot.subjects || []).forEach((item, index) => {
    const group = `subject-${index}`;
    pushWrapped(lines, `${index + 1}. ${item.name} | Nilai ${score(item.final_score)}${item.predicate ? ` | ${item.predicate}` : ""}`, { group });
    if (item.description) pushWrapped(lines, `   Capaian: ${item.description}`, { size: 9, group });
  });
  if (snapshot.summary) {
    lines.push({ text: `Jumlah: ${score(snapshot.summary.total)} | Rata-rata: ${score(snapshot.summary.average)}`, bold: true, gap: 6 });
  }
  if (ranking.rank != null) lines.push({ text: `Peringkat ${ranking.rank} dari ${ranking.participant_count} santri`, bold: true, gap: 6 });
  lines.push({ text: "ABSENSI", bold: true });
  lines.push({ text: `Sakit: ${attendance.sakit || 0} | Izin: ${attendance.izin || 0} | Alfa: ${attendance.alfa || 0}` });
  if (snapshot.homeroom_notes) pushWrapped(lines, `Catatan wali kelas: ${snapshot.homeroom_notes}`, { gap: 6 });
  if (snapshot.development_notes) pushWrapped(lines, `Perkembangan/sikap: ${snapshot.development_notes}`);
  const signer = snapshot.signer || {};
  lines.push({ text: `${snapshot.issue_place || ""}, ${snapshot.issue_date || ""}`, gap: 14 });
  lines.push({ text: signer.title || "Penandatangan", bold: true });
  lines.push({ text: "", gap: 20 });
  lines.push({ text: signer.name || "-", bold: true });
  return lines;
}

function buildAcademicReportPdf(snapshot) {
  const source = reportLines(snapshot);
  const pages = [];
  let currentPage = [], remaining = 740;
  for (let index = 0; index < source.length;) {
    const group = [source[index]];
    const groupKey = source[index].group;
    index += 1;
    while (groupKey && index < source.length && source[index].group === groupKey) { group.push(source[index]); index += 1; }
    const height = group.reduce((total, line) => total + 17 + (line.gap || 0), 0);
    if (currentPage.length && remaining - height < 35) { pages.push(currentPage); currentPage = []; remaining = 740; }
    currentPage.push(...group); remaining -= height;
  }
  if (currentPage.length) pages.push(currentPage);
  const objects = [null];
  const add = (value) => { objects.push(value); return objects.length - 1; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pagesId = add("");
  const pageIds = [];
  pages.forEach((lines, pageIndex) => {
    let y = 800;
    const commands = ["BT"];
    lines.forEach((line) => {
      const size = line.size || 10;
      y -= 17 + (line.gap || 0);
      commands.push(`/${line.bold ? "F2" : "F1"} ${size} Tf`, `50 ${y} Td`, `(${pdfText(line.text)}) Tj`, `-50 -${y} Td`);
    });
    commands.push("/F1 8 Tf", `50 28 Td`, `(Halaman ${pageIndex + 1} dari ${pages.length}) Tj`, "ET");
    const stream = commands.join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  objects[pagesId] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(output);
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, "binary");
}

module.exports = { buildAcademicReportPdf, reportLines, wrapText };
