import jadx.api.*;
import java.io.File;
import java.nio.file.*;
public class DumpApk {
  public static void main(String[] args) throws Exception {
    JadxArgs options = new JadxArgs();
    options.setInputFile(new File(args[0]));
    options.setThreadsCount(2);
    options.setSkipResources(true);
    options.setShowInconsistentCode(true);
    try (JadxDecompiler jadx = new JadxDecompiler(options)) {
      jadx.load();
      int count = 0;
      for (JavaClass cls : jadx.getClasses()) {
        String name = cls.getRawName();
        if (!(name.startsWith("com.neo.") || name.startsWith("com.jieli."))) continue;
        Path out = Path.of(args[1], name.replace('.', '/') + ".java");
        Files.createDirectories(out.getParent());
        Files.writeString(out, cls.getCode());
        count++;
      }
      System.out.println("Exported classes: " + count + "; JADX errors: " + jadx.getErrorsCount());
    }
  }
}
