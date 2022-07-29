all: build install lint

.PHONY: build install

build:
	echo "glib-compile-schemas --strict --targetdir=schemas/ schemas"

install:
	mkdir -p ~/.local/share/gnome-shell/extensions/search-light@icedman.github.com/
	cp -R ./* ~/.local/share/gnome-shell/extensions/search-light@icedman.github.com/

publish:
	rm -rf build
	mkdir build
	cp LICENSE ./build
	cp *.js ./build
	cp metadata.json ./build
	cp stylesheet.css ./build
	cp README.md ./build
	echo "cp -R schemas ./build"
	rm -rf ./*.zip
	cd build ; \
	zip -qr ../search-light@icedman.github.com.zip .

lint:
	eslint ./

pretty:
	prettier --single-quote --write "**/*.js"
