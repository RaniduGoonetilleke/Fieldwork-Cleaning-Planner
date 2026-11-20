#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {verifyBookingExport} from './public/booking-report.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) {
  console.error('Usage: node replay_booking.mjs path/to/fieldwork-booking.json');
  process.exitCode = 2;
} else {
  try {
    const result = await verifyBookingExport(await readFile(file, 'utf8'));
    console.log(`PASS: ${result.assessments.length} job assessment(s) reproduced for ${result.release}.`);
    console.log('This checks the saved planning calculation, not robot suitability, workplace safety or completed work.');
    console.log('The fingerprint checks consistency; it is not a signature or proof of who entered the answers.');
  } catch (error) {
    console.error('FAIL: ' + error.message);
    process.exitCode = 1;
  }
}
