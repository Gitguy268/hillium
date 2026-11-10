# Template for Gitguy268/homebrew-tap Casks/hillium.rb. Fill in SHA256_APP from the release's
# SHA256SUMS after the release workflow has attached the zip.
cask "hillium" do
  version "0.1.0"
  sha256 "SHA256_APP"

  url "https://github.com/Gitguy268/hillium/releases/download/v#{version}/Hillium-#{version}-macos-arm64.zip"
  name "Hillium Browser"
  desc "Privacy-first Chromium browser with side tabs, a local assistant and three looks"
  homepage "https://github.com/Gitguy268/hillium"

  depends_on arch: :arm64
  depends_on macos: ">= :monterey"

  app "Hillium.app"

  # The release build is signed ad hoc, not notarised; clear the download quarantine so it opens.
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/Hillium.app"]
  end

  zap trash: [
    "~/Library/Application Support/Hillium Browser",
    "~/Library/Caches/Hillium",
    "~/Library/Preferences/org.hillium.browser.plist",
    "~/Library/Saved Application State/org.hillium.browser.savedState",
  ]

  caveats <<~EOS
    Hillium Browser is not signed by Apple. The cask removes the quarantine flag after install.
    The Helium companion kit (extension and local SearXNG) is separate; see the README.
  EOS
end
