import { createSignerFromKeypair, PublicKey, publicKey, signerIdentity } from "@metaplex-foundation/umi";
import { deserializeRecordData, findNameRecordPDA, serializeRecordData, WALLET_RECORD_TYPE } from "./sdk/ts/src/resolution";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSolanaRecordServiceProgram } from "./sdk/ts/src/programs";
import { fetchRecord, updateRecord, updateRecordTokenizable } from "./sdk/ts/src";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { address, createSolanaRpc} from "@solana/kit";
import {
    Extension,
    getUpdateTokenMetadataFieldInstruction,
  fetchMint,
} from '@solana-program/token-2022'

const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=e11babea-e842-4203-abff-962703652ccd';
const SRS_PROGRAM_ID = publicKey('srsAwVAQxYzsQNTQ2sLwbj7LyVTrvn6JX8pSGzaubFk');
const DOMA_CLASS_ADDRESS = publicKey('CCcpHtBokXDR9PimwAKsxyspDoVtXxXjAJTBSsC1jHYY');

const NAME = 'yevhenii-solana-resolution2.com';
const ADDRESS = publicKey('B5DA64jCiC7gscMDbBBgzCdv3AzxyGxJYeZXc7wR4opf');


const umi = createUmi(RPC_URL);
const srsProgram = createSolanaRecordServiceProgram();
srsProgram.publicKey = SRS_PROGRAM_ID;
umi.programs.add(srsProgram);

const privateKeyBase58 = '44kETAy6WtjwumchQQ3pBPNmsE7XVrEVKEuPLHwZacJ3t5J1sgt2EYuSXvshMuSVgT7kCC9M7xFJjGZpY9pCEXPq';
const secretKey = base58.serialize(privateKeyBase58);

const keypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
const signer = createSignerFromKeypair(umi, keypair);

umi.use(signerIdentity(signer));

async function testScript() {
    const recordAddress = findNameRecordPDA(umi, NAME, { classAddress: DOMA_CLASS_ADDRESS });
    console.log('Record PDA:', recordAddress.toString());

    const recordData = serializeRecordData([[WALLET_RECORD_TYPE, `solana:_:${ADDRESS}`]]);
    console.log('Serialized Record Data:', Buffer.from(recordData).toString('hex'));

    const recordInfo = await fetchRecord(umi, recordAddress);
    console.log('Fetched Record Info:', recordInfo);

    await printTokenMetadata(recordInfo.owner);

    // const updateTXBuilder = await updateRecord(umi, {
    //     authority: signer,
    //     payer: signer,
    //     class: DOMA_CLASS_ADDRESS,
    //     record: recordAddress,
    //     data: recordData,
    // });

    // const { signature, result } = await updateTXBuilder.sendAndConfirm(umi);
    // console.log('Transaction Signature:', signature);
    // console.log('Transaction Result:', result);

    // const updatedRecordData = await fetchRecord(umi, recordAddress);
    // const deserializedData = updatedRecordData ? deserializeRecordData(updatedRecordData.data) : null;
    // console.log('Deserialized Record Data:', deserializedData);
}

async function printTokenMetadata(recordOwner: PublicKey ) {
    const rpc = createSolanaRpc(RPC_URL);

    const mintAddress = address(recordOwner.toString());
    const mint = await fetchMint(rpc, mintAddress);

    console.log('Mint address:', mintAddress.toString());

    const extensions = mint.data.extensions.__option === 'Some' ? mint.data.extensions.value : [];

    for (const extension of extensions) {
        console.log('Extension:', extension);
    }

    // const metadataPointer = extensions.find(ext => ext.__kind === 'MetadataPointer');
    // const tokenMetadata = extensions.find(ext => ext.__kind === 'TokenMetadata');

    // console.log('Metadata Pointer Extension:', metadataPointer);
    // console.log('Token Metadata Extension:', tokenMetadata);
}

testScript();