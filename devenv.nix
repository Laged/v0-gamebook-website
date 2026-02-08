{ pkgs }:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_22
    nodePackages.pnpm
    git
  ];

  shellHook = ''
    echo "gamebook dev environment loaded"
    echo "node $(node --version) | pnpm $(pnpm --version)"
  '';
}
