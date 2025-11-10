import { PrismaClient } from '@prisma/client';
import { LicenseService } from '../src/services/license.service';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...\n');

  // Check if already seeded
  const existingLicenses = await prisma.license.count();
  if (existingLicenses > 0) {
    console.log('⏭️  Database already contains licenses, skipping seed...\n');
    return;
  }

  // Create test users
  const user1 = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      name: 'Test User',
      company: 'Test Company',
    },
  });
  console.log('✅ User 1:', user1.email);

  const user2 = await prisma.user.upsert({
    where: { email: 'demo@appgrid.com' },
    update: {},
    create: {
      email: 'demo@appgrid.com',
      name: 'Demo User',
      company: 'AppGrid Inc',
    },
  });
  console.log('✅ User 2:', user2.email);

  const user3 = await prisma.user.upsert({
    where: { email: 'premium@example.com' },
    update: {},
    create: {
      email: 'premium@example.com',
      name: 'Premium User',
      company: 'Premium Corp',
    },
  });
  console.log('✅ User 3:', user3.email);

  console.log('\n🔑 Creating licenses...\n');

  // Create licenses with different configurations
  const license1 = await LicenseService.createLicense({
    userId: user1.id,
    maxActivations: 1,
    notes: 'Basic license for testing',
  });
  console.log('✅ License 1:', license1.licenseKey, '(Basic, 1 activation)');

  const license2 = await LicenseService.createLicense({
    userId: user2.id,
    maxActivations: 5,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
    notes: 'Standard license with expiry',
  });
  console.log('✅ License 2:', license2.licenseKey, '(Standard, 5 activations, expires in 1 year)');

  const license3 = await LicenseService.createLicense({
    userId: user3.id,
    maxActivations: 10,
    metadata: {
      tier: 'premium',
      features: ['advanced-analytics', 'priority-support', 'custom-integrations'],
    },
    notes: 'Premium license with unlimited duration',
  });
  console.log('✅ License 3:', license3.licenseKey, '(Premium, 10 activations, no expiry)');

  const license4 = await LicenseService.createLicense({
    userId: user1.id,
    maxActivations: 3,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    notes: 'Trial license',
  });
  console.log('✅ License 4:', license4.licenseKey, '(Trial, 3 activations, expires in 30 days)');

  const license5 = await LicenseService.createLicense({
    userId: user2.id,
    maxActivations: 1,
    expiresAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Expired 7 days ago
    notes: 'Expired license for testing',
  });
  console.log('✅ License 5:', license5.licenseKey, '(Expired)');

  console.log('\n📋 Seed Summary:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`👤 Users created: 3`);
  console.log(`🔑 Licenses created: 5`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n🎉 Seeding completed successfully!\n`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Error during seeding:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
