# curl -fsSL https://raw.githubusercontent.com/kvendrik/greg/main/scripts/install.bash | bash

set -e

if [ -d "~/.greg" ]; then
  echo "~/.greg already exists. Exiting..."
  exit 1
fi

mkdir -p ~/.greg
git clone git@github.com:kvendrik/greg.git ~/.greg/src
cd ~/.greg/src

bun install
bun link

if ! greg --help > /dev/null 2>&1; then
  echo "\`greg --help\` failed. Try running it manually."
  exit 1
fi

greg quickstart
