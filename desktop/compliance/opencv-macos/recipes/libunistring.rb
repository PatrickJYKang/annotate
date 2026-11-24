class Libunistring < Formula
  desc "C string library for manipulating Unicode strings"
  homepage "https://www.gnu.org/software/libunistring/"
  url "https://ftp.gnu.org/gnu/libunistring/libunistring-1.3.tar.gz"
  mirror "https://ftpmirror.gnu.org/libunistring/libunistring-1.3.tar.gz"
  mirror "http://ftp.gnu.org/gnu/libunistring/libunistring-1.3.tar.gz"
  sha256 "8ea8ccf86c09dd801c8cac19878e804e54f707cf69884371130d20bde68386b7"
  license any_of: ["GPL-2.0-only", "LGPL-3.0-or-later"]

  def install
    # macOS iconv implementation is slightly broken since Sonoma.
    # This is also why we skip `make check`.
    # https://github.com/coreutils/gnulib/commit/bab130878fe57086921fa7024d328341758ed453
    # https://savannah.gnu.org/bugs/?65686
    ENV["am_cv_func_iconv_works"] = "yes" if OS.mac? && MacOS.version == :sequoia
    system "./configure", "--disable-silent-rules", *std_configure_args
    system "make"
    system "make", "check" if !OS.mac? || MacOS.version < :sonoma || MacOS.version > :sequoia
    system "make", "install"
  end

  test do
    (testpath/"test.c").write <<~EOS
      #include <uniname.h>
      #include <unistdio.h>
      #include <unistr.h>
      #include <stdlib.h>
      int main (void) {
        uint32_t s[2] = {};
        uint8_t buff[12] = {};
        if (u32_uctomb (s, unicode_name_character ("BEER MUG"), sizeof s) != 1) abort();
        if (u8_sprintf (buff, "%llU", s) != 4) abort();
        printf ("%s\\n", buff);
        return 0;
      }
    EOS
    system ENV.cc, "test.c", "-I#{include}", "-L#{lib}", "-lunistring",
                   "-o", "test"
    assert_equal "🍺", shell_output("./test").chomp
  end
end
