/**
 * upload-photos.js
 * Migra as fotos locais do repositório para o Supabase Storage.
 *
 * USO:
 *   node upload-photos.js
 *
 * Antes de rodar, defina as variáveis de ambiente:
 *   Windows PowerShell:
 *     $env:ADMIN_EMAIL="seu@email.com"; $env:ADMIN_PASS="suasenha"; node upload-photos.js
 *
 *   Linux/Mac:
 *     ADMIN_EMAIL=seu@email.com ADMIN_PASS=suasenha node upload-photos.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

// ─── Configuração ────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://cfirjoyjkazfryvzmjvy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1qi0aW8SsJh_omDi2KtpAA_la5uITiT';

const EMAIL    = process.env.ADMIN_EMAIL || '';
const PASSWORD = process.env.ADMIN_PASS  || '';

// Mapa de pastas locais → página destino no Supabase
const UPLOADS = [
  {
    dir:  path.join(__dirname, 'terceirapaginanamoro', 'arquivoscontador'),
    page: 'namoro',
    label: 'Galeria Namoro'
  },
  // Descomente para migrar também os cards do seletor:
  // {
  //   dir:  path.join(__dirname, 'segundapagina', 'arquivosimagens'),
  //   page: 'seletor',
  //   label: 'Cards Seletor'
  // }
];
// ─────────────────────────────────────────────────────────────────────────────

function getMime(ext) {
  const map = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif' };
  return map[ext.toLowerCase()] || 'image/jpeg';
}

async function uploadGroup(sb, userId, { dir, page, label }) {
  if (!fs.existsSync(dir)) {
    console.log(`  ⚠  Pasta não encontrada: ${dir} — pulando.`);
    return { ok: 0, fail: 0 };
  }

  const files = fs.readdirSync(dir)
    .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
    .sort();

  console.log(`\n📁  ${label}  (${files.length} arquivos)`);
  let ok = 0, fail = 0;

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filepath = path.join(dir, filename);
    const ext      = path.extname(filename).slice(1);
    const mime     = getMime(ext);
    const storageName = `${page}_${String(i + 1).padStart(3, '0')}_${filename}`;

    process.stdout.write(`  [${i + 1}/${files.length}] ${filename} … `);

    // Verifica se já existe no banco (evita duplicatas)
    const { data: exists } = await sb
      .from('gallery_photos')
      .select('id')
      .eq('storage_path', storageName)
      .maybeSingle();

    if (exists) {
      console.log('já existe, pulando');
      ok++;
      continue;
    }

    // Upload para Supabase Storage
    const buffer = fs.readFileSync(filepath);
    const { error: upErr } = await sb.storage
      .from('gallery')
      .upload(storageName, buffer, { contentType: mime, cacheControl: '3600', upsert: false });

    if (upErr && upErr.statusCode !== '409') {
      console.log(`❌  Storage: ${upErr.message}`);
      fail++;
      continue;
    }

    // URL pública
    const { data: urlData } = sb.storage.from('gallery').getPublicUrl(storageName);

    // Inserir metadado no banco
    const { error: dbErr } = await sb.from('gallery_photos').insert({
      url:           urlData.publicUrl,
      storage_path:  storageName,
      display_order: i,
      page:          page,
      uploaded_by:   userId
    });

    if (dbErr) {
      console.log(`⚠  DB: ${dbErr.message}`);
      fail++;
    } else {
      console.log('✅');
      ok++;
    }

    // Delay leve para não saturar a API
    await new Promise(r => setTimeout(r, 250));
  }

  return { ok, fail };
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  📷  Migração de Fotos → Supabase');
  console.log('═══════════════════════════════════════\n');

  if (!EMAIL || !PASSWORD) {
    console.error('❌  Defina ADMIN_EMAIL e ADMIN_PASS antes de rodar.\n');
    console.error('  PowerShell:');
    console.error('    $env:ADMIN_EMAIL="seu@email.com"; $env:ADMIN_PASS="senha"; node upload-photos.js\n');
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Login
  process.stdout.write('🔐  Autenticando … ');
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (authErr) { console.log(`❌  ${authErr.message}`); process.exit(1); }
  console.log(`✅  Logado como ${auth.user.email}\n`);

  let totalOk = 0, totalFail = 0;

  for (const group of UPLOADS) {
    const { ok, fail } = await uploadGroup(sb, auth.user.id, group);
    totalOk   += ok;
    totalFail += fail;
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`  Resultado: ${totalOk} enviadas · ${totalFail} falhas`);
  console.log('═══════════════════════════════════════\n');

  await sb.auth.signOut();
}

main().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
