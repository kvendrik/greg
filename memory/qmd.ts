import { execSync } from 'child_process';

export function createCollection(collectionName: string, description: string) {
  execSync(
    `bun run qmd collection add memory/.data/${collectionName} --name ${collectionName}`
  );

  execSync(`bun run qmd context add qmd://${collectionName} "${description}"`);
}

export function embed() {
  execSync('bun run qmd embed');
}
