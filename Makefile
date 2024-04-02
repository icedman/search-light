all: build install lint

.PHONY: build install

build:
	glib-compile-schemas --strict --targetdir=schemas/ schemas

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
	cp -r ui ./build
	cp -r preferences ./build
	cp -r effects ./build
	cp -r apps ./build
	cp README.md ./build
	cp CHANGELOG.md ./build
	cp -R schemas ./build
	rm -rf ./build/effects
	rm -rf ./build/_*.js
	rm -rf ./build/utils.js
	rm -rf ./build/drawing.js
	rm -rf ./build/chamfer.js
	rm -rf ./*.zip
	cd build ; \
	zip -qr ../search-light@icedman.github.com.zip .

install-zip: publish
	echo "installing zip..."
	rm -rf ~/.local/share/gnome-shell/extensions/search-light@icedman.github.com
	mkdir -p ~/.local/share/gnome-shell/extensions/search-light@icedman.github.com/
	unzip -q search-light@icedman.github.com.zip -d ~/.local/share/gnome-shell/extensions/search-light@icedman.github.com/

test-prefs:
	gnome-extensions prefs search-light@icedman.github.com

test-shell: install
	env GNOME_SHELL_SLOWDOWN_FACTOR=1 \
		MUTTER_DEBUG_DUMMY_MODE_SPECS=1280x800 \
	 	MUTTER_DEBUG_DUMMY_MONITOR_SCALES=1.5 \
		dbus-run-session -- gnome-shell --nested --wayland
	rm /run/user/1000/gnome-shell-disable-extensions

lint:
	eslint ./

xml-lint:
	cd ui ; \
	find . -name "*.ui" -type f -exec xmllint --output '{}' --format '{}' \;

pretty: xml-lint
	rm -rf ./build/*
	prettier --single-quote --write "**/*.js"
