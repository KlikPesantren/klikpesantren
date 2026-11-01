const STATUS_LABELS={
 DRAFT:'Belum Selesai',ACTIVE:'Sedang Berjalan',CLOSED:'Sudah Selesai',
 REVIEW:'Menunggu Pemeriksaan',APPROVED:'Sudah Disetujui',PUBLISHED:'Rapor Sudah Terbit',
 REVISION_REQUIRED:'Perlu Diperbaiki',
};

const DECISION_LABELS={
 NAIK:'Naik Kelas',TETAP:'Tetap di Kelas',LULUS:'Lulus',PINDAH:'Pindah / Keluar',
 PERLU_PEMERIKSAAN:'Perlu Diperiksa',
};

export const academicStatusLabel=value=>STATUS_LABELS[value]||value||'Belum Selesai';
export const promotionDecisionLabel=value=>DECISION_LABELS[value]||value||'Belum Ditentukan';
