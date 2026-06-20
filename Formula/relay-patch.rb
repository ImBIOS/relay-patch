# typed: false
# frozen_string_literal: true

class RelayPatch < Formula
  desc "Keep up-to-date upstream + your custom patches. Patches are intent, not diffs."
  homepage "https://github.com/ImBIOS/relay-patch"
  version "0.2.8"
  license "MIT"

  on_macos do
    on_intel do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.8/relay-patch-darwin-x64"
      sha256 "0b0ce68f688270012c4f8edb9daff1605199bc2aad64be5dbc582ec392ce8c63"
    end
    on_arm do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.8/relay-patch-darwin-arm64"
      sha256 "8e8db2b68bc04b97960233c798db6051a02b9d51cd532d7539ef518605f3c87b"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.8/relay-patch-linux-x64"
      sha256 "0fd06020fa228270844de5f9f933a440842c1538444131b874f8db4a14049cec"
    end
    on_arm do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.8/relay-patch-linux-arm64"
      sha256 "c524f9510bd7e210a9bb2308911bff4d0c3753c759ba50813b7192ebceb43356"
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
