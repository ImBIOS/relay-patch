# typed: false
# frozen_string_literal: true

class RelayPatch < Formula
  desc "Keep up-to-date upstream + your custom patches. Patches are intent, not diffs."
  homepage "https://github.com/ImBIOS/relay-patch"
  version "0.2.10"
  license "MIT"

  on_macos do
    on_intel do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.10/relay-patch-darwin-x64"
      sha256 "c47b136c47a8865757ceff381598790bb8d2e7ac4ca1801d807914b7bdd53540"
    end
    on_arm do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.10/relay-patch-darwin-arm64"
      sha256 "8b5f132acaeee3971c37379a6962cf5796974a58bd78d6a2c24c5409108baff3"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.10/relay-patch-linux-x64"
      sha256 "c1da45726c630756c952ee4a754c1b9e8fd79962b310a65de2a5f87bf7ca1ddb"
    end
    on_arm do
      url "https://github.com/ImBIOS/relay-patch/releases/download/v0.2.10/relay-patch-linux-arm64"
      sha256 "fe5a3e74fb9e6bb89c9776ce9102542d4539b6436943f9c994bcfa420355ac8a"
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
