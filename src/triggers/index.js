/**
 * Confluence "sayfa guncellendi" olayi ve arka plan kuyrugu tuketicisi.
 * Tetikleyici hizli olmali; asil is (fark ozeti, yorum yazma) kuyrukta yapilir.
 */
import { enqueuePageUpdated, processJob, pollWatchedPages } from '../lib/service';

export async function pageUpdated(event) {
  const content = event && event.content;
  if (!content || content.type !== 'page') return;
  console.log(`spec page ${content.id} updated (v${content.version && content.version.number})`);
  // Sayfayi duzenleyen kisinin kimligi: arka plan isi sayfayi onun yetkisiyle okur
  await enqueuePageUpdated(content.id, event.atlassianId);
}

/** Kuyruk tuketicisi: event.body kuyruga atilan veridir. */
export async function jobWorker(event) {
  await processJob(event.body);
}

/** Saatlik zamanlanmis tetikleyici: degisen spesifikasyonlari yakalar (olay teslimine yedek). */
export async function pollSpecs() {
  const r = await pollWatchedPages();
  if (r.queued) console.log(`hourly check: ${r.queued} changed spec page(s)`);
}
