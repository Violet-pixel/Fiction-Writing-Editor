/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.teste;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/**
 * Mini framework de testes (o Maven Central está bloqueado, então nada de JUnit): métodos
 * anotados com {@link Teste} são executados por reflexão e as falhas são listadas no final.
 */
public final class TestRunner {

    /** Marca um método público, sem argumentos, como teste. */
    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    public @interface Teste {
    }

    /** Falha de asserção. */
    public static final class Falha extends AssertionError {
        private static final long serialVersionUID = 1L;

        public Falha(String m) {
            super(m);
        }
    }

    private static final List<Class<?>> CLASSES = List.of(JsonTest.class, TextStatsTest.class, SpellTest.class,
            IdeasTest.class, ExportTest.class, ServerTest.class, FixturesTest.class);

    private TestRunner() {
    }

    public static void main(String[] args) throws Exception {
        String filtro = args.length > 0 ? args[0] : null;
        int ok = 0;
        List<String> falhas = new ArrayList<>();
        long t0 = System.nanoTime();
        for (Class<?> c : CLASSES) {
            Object instancia = c.getDeclaredConstructor().newInstance();
            Method[] metodos = c.getDeclaredMethods();
            Arrays.sort(metodos, Comparator.comparing(Method::getName));
            for (Method m : metodos) {
                if (!m.isAnnotationPresent(Teste.class)) {
                    continue;
                }
                String nome = c.getSimpleName() + "." + m.getName();
                if (filtro != null && !nome.contains(filtro)) {
                    continue;
                }
                try {
                    m.invoke(instancia);
                    ok++;
                    System.out.println("  ok   " + nome);
                } catch (InvocationTargetException e) {
                    Throwable causa = e.getCause();
                    falhas.add(nome + ": " + causa);
                    System.out.println("  FALHOU " + nome + ": " + causa);
                }
            }
        }
        double s = (System.nanoTime() - t0) / 1e9;
        System.out.printf("%n%d teste(s) passaram, %d falharam (%.1f s).%n", ok, falhas.size(), s);
        if (!falhas.isEmpty()) {
            falhas.forEach(f -> System.out.println(" - " + f));
            System.exit(1);
        }
        System.exit(0);
    }

    // ------------------------------------------------------------------ asserções

    public static void igual(Object esperado, Object obtido) {
        igual(esperado, obtido, "");
    }

    public static void igual(Object esperado, Object obtido, String contexto) {
        if (esperado instanceof Number a && obtido instanceof Number b) {
            if (a.doubleValue() == b.doubleValue()) {
                return;
            }
        } else if (Objects.equals(esperado, obtido)) {
            return;
        }
        throw new Falha((contexto.isEmpty() ? "" : contexto + ": ") + "esperava <" + esperado + "> mas obteve <" + obtido + ">");
    }

    public static void verdade(boolean c, String mensagem) {
        if (!c) {
            throw new Falha(mensagem);
        }
    }

    public static void falso(boolean c, String mensagem) {
        verdade(!c, mensagem);
    }

    public static void contem(String texto, String trecho) {
        if (texto == null || !texto.contains(trecho)) {
            throw new Falha("esperava encontrar <" + trecho + "> em <" + texto + ">");
        }
    }

    /** Executa e exige que lance a exceção do tipo dado. */
    public static <T extends Throwable> T lanca(Class<T> tipo, Runnable r) {
        try {
            r.run();
        } catch (Throwable t) {
            if (tipo.isInstance(t)) {
                return tipo.cast(t);
            }
            throw new Falha("esperava " + tipo.getSimpleName() + " mas veio " + t);
        }
        throw new Falha("esperava " + tipo.getSimpleName() + " mas nada foi lançado");
    }
}
