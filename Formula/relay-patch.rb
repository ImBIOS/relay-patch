# typed: false
# frozen_string_literal: true

class RelayPatch < Formula
  desc "Keep up-to-date upstream + your custom patches. Patches are intent, not diffs."
  homepage "https://github.com/ImBIOS/relay-patch"
  version "0.2.9"
  license "MIT"

  on_macos do
    on_intel do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.9/relay-patch-darwin-x64"
      sha256 "a50920d120ce069d409f13f159fad110c95c111b0d468042244a80367835000c"
    end
    on_arm do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.9/relay-patch-darwin-arm64"
      sha256 "4527fe808c62822b089b38006e03756a49df31003e6c247c0acfcb8d8669b53a"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.9/relay-patch-linux-x64"
      sha256 "76d9e377b8552f7e50b03997e0cfa7b301783a72af7c241e832af2572318264e"
    end
    on_arm do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.9/relay-patch-linux-arm64"
      sha256 "3a0ac34686b60643b502bd1a8e2634b0c86fab8e1b8266704efa861e6cd89312"
    end
  end

  def install
    os_arch = if OS.mac? && Hardware::CPU.arm?
      "darwin-arm64"
    elsif OS.mac?
      "darwin-x64"
    elsif Hardware::CPU.arm?
      "linux-arm64"
    else
      "linux-x64"
    end
    bin.install "relay-patch-\#{os_arch}" => "relay-patch"
  end

  test do
    assert_match "relay-patch", shell_output("#{bin}/relay-patch --help")
  end
end
